import ccxt
import pandas as pd
import pandas_ta as ta
import psycopg2
from flask import Flask, render_template, request, jsonify
import time
import os
from urllib.parse import urlparse
import psycopg2.extras
from ccxt.base.errors import NetworkError, ExchangeError
from datetime import datetime, timedelta

app = Flask(__name__)

# Configuration Kraken Futures
exchange = ccxt.krakenfutures({
    'apiKey': os.getenv('KRAKEN_API_KEY', '2cODKhMXAL9MqITr+81uSxqVfXoZCbVmnklgqsB2Ps7qj+GtI6douZLv'),
    'secret': os.getenv('KRAKEN_SECRET', 'u6TZEwy6inpuWG5B10OiecmGRFrz2SNU46WTMJIuqcsm2lYvqqiSXR0G5uTBcWiaLk/oYChgWjsNB82uoMiD2wtJ'),
    'enableRateLimit': True
})

# Charger les marchés
markets_loaded = False
try:
    exchange.load_markets()
    print("Paires disponibles :", list(exchange.symbols)[:20])
    markets_loaded = True
except ExchangeError as e:
    print(f"Erreur lors du chargement des marchés : {e}")

# Configuration Neon
db_url = os.getenv('NEON_DB_URL', "postgresql://autonomix_owner:npg_rDMoOyZ8a3Xk@ep-mute-brook-a23892dj-pooler.eu-central-1.aws.neon.tech/autonomix?sslmode=require")
url = urlparse(db_url)
db_conn = None

def get_db_connection():
    global db_conn
    try:
        if db_conn is None or db_conn.closed:
            db_conn = psycopg2.connect(
                dbname=url.path[1:],
                user=url.username,
                password=url.password,
                host=url.hostname,
                port=url.port,
                sslmode='require',
                connect_timeout=10
            )
        return db_conn
    except Exception as e:
        print(f"Erreur de connexion à Neon : {e}")
        return None

# Initialiser la table trades
def initialize_trades_table():
    conn = get_db_connection()
    if conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP,
                pair VARCHAR(20),
                type VARCHAR(10),
                entry_price FLOAT,
                tp_price FLOAT,
                sl_price FLOAT,
                exit_price FLOAT,
                exit_time TIMESTAMP,
                profit FLOAT,
                capital FLOAT,
                status VARCHAR(20) DEFAULT 'proposed',
                amount FLOAT
            )
        """)
        conn.commit()
        cursor.close()

initialize_trades_table()

# Récupérer le solde Kraken
def get_balance():
    try:
        balance = exchange.fetch_balance()
        total_usd = balance['total']['USD'] if 'USD' in balance['total'] else 0
        print(f"Solde Kraken (USD) : {total_usd}")
        return total_usd
    except Exception as e:
        print(f"Erreur lors de la récupération du solde : {e}")
        return 0

# Paramètres
symbols = ['BTC/USD:USD', 'ETH/USD:USD', 'XRP/USD:USD', 'SOL/USD:USD']
timeframe = '1h'
capital = 10.0

# Récupérer les données historiques
def get_historical_data(symbol, timeframe='1h', limit=72, retries=3):
    for attempt in range(retries):
        try:
            if not markets_loaded or symbol not in exchange.symbols:
                raise ValueError(f"Paire {symbol} non disponible")
            print(f"Tentative de récupération des données pour {symbol} (essai {attempt + 1}/{retries})")
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            if len(df) < 24:
                raise ValueError(f"Pas assez de données pour {symbol}")
            print(f"Données récupérées pour {symbol} : {len(df)} lignes")
            return df
        except NetworkError as e:
            print(f"Erreur réseau pour {symbol} : {e}")
            if attempt < retries - 1:
                time.sleep(5)
            else:
                raise
        except Exception as e:
            print(f"Erreur pour {symbol} : {e}")
            return None

# Calculer les indicateurs
def calculate_indicators(df):
    df = df.dropna()
    if len(df) < 24:
        raise ValueError("Pas assez de données")
    bb = ta.bbands(df['close'], length=20)
    df['rsi'] = ta.rsi(df['close'], length=14)
    df['sma20'] = ta.sma(df['close'], length=20)
    df['sma50'] = ta.sma(df['close'], length=50)
    df['bb_lower'] = bb['BBL_20_2.0']
    df['bb_upper'] = bb['BBU_20_2.0']
    df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
    high = df['high'].rolling(window=20).max()
    low = df['low'].rolling(window=20).min()
    df['fib_0.382'] = low + (high - low) * 0.382
    df['fib_0.618'] = low + (high - low) * 0.618
    return df.dropna()

# Proposer un trade
def propose_trade():
    proposals = []
    for symbol in symbols:
        df = get_historical_data(symbol)
        if df is not None:
            df = calculate_indicators(df)
            last_row = df.iloc[-1]
            long_condition = (last_row['rsi'] < 50 and last_row['sma20'] > last_row['sma50'] and
                            (last_row['close'] < last_row['bb_lower'] or last_row['close'] <= last_row['fib_0.618']))
            short_condition = (last_row['rsi'] > 50 and (last_row['sma20'] < last_row['sma50'] or last_row['close'] > last_row['bb_upper']) and
                             last_row['close'] >= last_row['fib_0.382'])
            if long_condition or short_condition:
                entry_price = last_row['close']
                tp_price = entry_price * 1.02 if long_condition else entry_price * 0.98
                sl_price = entry_price * 0.98 if long_condition else entry_price * 1.02
                amount = capital / entry_price * 50  # Levage fixe x50
                proposal = {
                    'pair': symbol,
                    'type': 'long' if long_condition else 'short',
                    'entry_price': entry_price,
                    'tp_price': tp_price,
                    'sl_price': sl_price,
                    'amount': amount,
                    'confirmed': False
                }
                conn = get_db_connection()
                if conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "INSERT INTO trades (timestamp, pair, type, entry_price, tp_price, sl_price, capital, amount, status) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (datetime.now(), symbol, 'long' if long_condition else 'short', entry_price, tp_price, sl_price, capital, amount, 'proposed')
                    )
                    conn.commit()
                    cursor.execute("SELECT LASTVAL()")
                    proposal['id'] = cursor.fetchone()[0]
                    cursor.close()
                proposals.append(proposal)
    return proposals

# Clôturer un trade automatiquement
def check_and_close_trades():
    conn = get_db_connection()
    if conn:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cursor.execute("SELECT * FROM trades WHERE status = 'confirmed' AND exit_price IS NULL")
        open_trades = cursor.fetchall()
        for trade in open_trades:
            current_price = exchange.fetch_ticker(trade['pair'])['last']
            if (trade['type'] == 'long' and current_price >= trade['tp_price']) or \
               (trade['type'] == 'short' and current_price <= trade['tp_price']):
                capital *= 2
                cursor.execute(
                    "UPDATE trades SET exit_price = %s, exit_time = %s, profit = %s, capital = %s, status = 'closed' WHERE id = %s",
                    (current_price, datetime.now(), capital - (capital / 2), capital, trade['id'])
                )
                conn.commit()
                print(f"Trade {trade['pair']} clôturé par TP, nouveau capital : {capital} $")
            elif (trade['type'] == 'long' and current_price <= trade['sl_price']) or \
                 (trade['type'] == 'short' and current_price >= trade['sl_price']):
                capital *= 0.8
                cursor.execute(
                    "UPDATE trades SET exit_price = %s, exit_time = %s, profit = %s, capital = %s, status = 'closed' WHERE id = %s",
                    (current_price, datetime.now(), capital - (capital / 0.8), capital, trade['id'])
                )
                conn.commit()
                print(f"Trade {trade['pair']} clôturé par SL, nouveau capital : {capital} $")
        cursor.close()

# Route principale
@app.route('/')
def dashboard():
    check_and_close_trades()
    proposals = propose_trade()
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
            cursor.execute("SELECT * FROM trades ORDER BY timestamp DESC")
            trades = cursor.fetchall()
            current_balance = get_balance()
            cursor.close()
            return render_template('public/dashboard.html', trades=trades, proposals=proposals, capital=capital, balance=current_balance)
        except Exception as e:
            print(f"Erreur dans dashboard : {e}")
            return "Erreur de connexion ou de données", 500
        finally:
            if conn:
                conn.close()
    return "Impossible de se connecter à la base de données", 500

# Confirmer un trade
@app.route('/confirm_trade', methods=['POST'])
def confirm_trade():
    data = request.json
    trade_id = data.get('id')
    entry_price = data.get('entry_price')
    tp_price = data.get('tp_price')
    sl_price = data.get('sl_price')
    amount = data.get('amount')
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE trades SET status = 'confirmed', entry_price = %s, tp_price = %s, sl_price = %s, amount = %s WHERE id = %s",
                (entry_price, tp_price, sl_price, amount, trade_id)
            )
            conn.commit()
            cursor.close()
            return jsonify({'status': 'success'})
        except Exception as e:
            print(f"Erreur lors de la confirmation : {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
    return jsonify({'status': 'error', 'message': 'Connexion échouée'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)