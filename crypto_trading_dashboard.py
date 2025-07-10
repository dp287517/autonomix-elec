Voici la version complète et refaite du fichier `crypto_trading_dashboard.py`. J'ai intégré les corrections suggérées précédemment pour résoudre les problèmes (comme le logging à ERROR pour éviter le bruit sur stderr, la gestion robuste des erreurs, l'utilisation publique de l'API Kraken sans clés obligatoires pour les fetches OHLCV, et des try-except supplémentaires autour des fetches pour skipper les paires défaillantes). J'ai aussi nettoyé le code pour plus de clarté, ajouté des commentaires, et assuré que le JSON de sortie est toujours produit même en cas d'erreur. Cela devrait fonctionner sans les erreurs 500 dues à stderr, tant que `ccxt`, `pandas` et `numpy` sont installés dans votre environnement.

```python
import os
import ccxt
import pandas as pd
import numpy as np
from datetime import datetime
import time
import warnings
import json
import sys
import logging

# Configurer le logging à ERROR pour éviter les logs INFO sur stderr en production
logging.basicConfig(level=logging.ERROR, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

warnings.filterwarnings("ignore")

# Configuration de l'API Kraken (public pour OHLCV, pas besoin de clés pour fetch_ohlcv)
kraken = ccxt.kraken({
    'enableRateLimit': True
})

# Si clés API présentes, les utiliser (pour futures extensions privées)
if os.getenv('KRAKEN_API_KEY') and os.getenv('KRAKEN_SECRET'):
    kraken.apiKey = os.getenv('KRAKEN_API_KEY')
    kraken.secret = os.getenv('KRAKEN_SECRET')

# Paires confirmées (mises à jour potentielles pour 2025, mais gardons les originales)
pairs = [
    'BTC/USD', 'ETH/USD', 'XRP/USD', 'SOL/USD', 'DOGE/USD', 'ADA/USD', 'SUI/USD',
    'AAVE/USD', 'LINK/USD', 'AVAX/USD', 'NEAR/USD', 'XLM/USD', 'LTC/USD'
]

# Paramètres
TIMEFRAMES = ['1h', '4h', '1d']
LIMIT = 100
BB_PERIOD = 20
BB_STD = 2
RSI_PERIOD = 14
EMA_FAST = 12
EMA_SLOW = 26
MACD_SIGNAL = 9
ATR_PERIOD = 14
MOMENTUM_PERIOD = 10
LEVERAGE = 50
TARGET_MOVE = 0.02
MIN_ATR_MULTIPLIER = 2.0

# Calcul des indicateurs
def calculate_indicators(df):
    if df.empty or len(df) < max(BB_PERIOD, RSI_PERIOD, EMA_SLOW, MOMENTUM_PERIOD):
        return None
    
    try:
        df['sma'] = df['close'].rolling(window=BB_PERIOD).mean()
        df['std'] = df['close'].rolling(window=BB_PERIOD).std()
        df['upper_bb'] = df['sma'] + BB_STD * df['std']
        df['lower_bb'] = df['sma'] - BB_STD * df['std']
        
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=RSI_PERIOD).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=RSI_PERIOD).mean()
        rs = gain / loss.replace(0, np.nan)
        df['rsi'] = 100 - (100 / (1 + rs))
        
        df['ema_fast'] = df['close'].ewm(span=EMA_FAST, adjust=False).mean()
        df['ema_slow'] = df['close'].ewm(span=EMA_SLOW, adjust=False).mean()
        
        df['macd'] = df['ema_fast'] - df['ema_slow']
        df['macd_signal'] = df['macd'].ewm(span=MACD_SIGNAL, adjust=False).mean()
        
        df['tr'] = np.maximum(
            df['high'] - df['low'],
            np.maximum(
                abs(df['high'] - df['close'].shift()),
                abs(df['low'] - df['close'].shift())
            )
        )
        df['atr'] = df['tr'].rolling(window=ATR_PERIOD).mean()
        
        df['momentum'] = df['close'] - df['close'].shift(MOMENTUM_PERIOD)
        
        high = df['high'].rolling(window=50).max()
        low = df['low'].rolling(window=50).min()
        diff = high - low
        df['fib_0.236'] = high - 0.236 * diff
        df['fib_0.382'] = high - 0.382 * diff
        df['fib_0.5'] = high - 0.5 * diff
        df['fib_0.618'] = high - 0.618 * diff
        df['fib_0.764'] = high - 0.764 * diff
        
        # Supports et résistances
        supports = []
        resistances = []
        current_price = df['close'].iloc[-1]
        for i in range(2, len(df) - 2):
            if df['low'].iloc[i] < df['low'].iloc[i-1] and df['low'].iloc[i] < df['low'].iloc[i+1] and df['low'].iloc[i] < current_price:
                supports.append(df['low'].iloc[i])
            if df['high'].iloc[i] > df['high'].iloc[i-1] and df['high'].iloc[i] > df['high'].iloc[i+1] and df['high'].iloc[i] > current_price:
                resistances.append(df['high'].iloc[i])
        
        support = min(supports, default=np.nan, key=lambda x: abs(x - current_price)) if supports else np.nan
        resistance = min(resistances, default=np.nan, key=lambda x: abs(x - current_price)) if resistances else np.nan
        
        if not np.isnan(support) and not np.isnan(resistance) and abs(support - resistance) < current_price * 0.001:
            support = np.nan if resistance < current_price else support
            resistance = np.nan if support > current_price else resistance
        
        df['supports'] = [support] * len(df)
        df['resistances'] = [resistance] * len(df)
        
        return df
    except Exception as e:
        return None

# Calcul du score
def calculate_score(last_row, signal_type, higher_timeframes=None):
    if higher_timeframes is None:
        higher_timeframes = []
    
    score = 0
    price = last_row['close']
    
    try:
        rsi = last_row['rsi']
        if not np.isnan(rsi):
            if signal_type == 'ACHAT':
                if rsi < 30:
                    score += 15
                elif rsi < 35:
                    score += 8
            else:
                if rsi > 70:
                    score += 15
                elif rsi > 65:
                    score += 8
        
        if not np.isnan(last_row['lower_bb']) and not np.isnan(last_row['upper_bb']):
            if signal_type == 'ACHAT':
                if price <= last_row['lower_bb']:
                    score += 15
                elif price <= last_row['sma']:
                    score += 8
            else:
                if price >= last_row['upper_bb']:
                    score += 15
                elif price >= last_row['sma']:
                    score += 8
        
        if not np.isnan(last_row['ema_fast']) and not np.isnan(last_row['ema_slow']):
            if signal_type == 'ACHAT':
                if last_row['ema_fast'] > last_row['ema_slow']:
                    score += 15
                elif last_row['ema_fast'] >= last_row['ema_slow'] * 0.995:
                    score += 8
            else:
                if last_row['ema_fast'] < last_row['ema_slow']:
                    score += 15
                elif last_row['ema_fast'] <= last_row['ema_slow'] * 1.005:
                    score += 8
        
        fib_levels = ['fib_0.236', 'fib_0.382', 'fib_0.5', 'fib_0.618', 'fib_0.764']
        fib_proximities = [abs(price - last_row[level]) / price for level in fib_levels if not np.isnan(last_row[level])]
        fib_proximity = min(fib_proximities, default=np.inf)
        if fib_proximity < 0.02:
            score += 15
        elif fib_proximity < 0.05:
            score += 8
        
        atr = last_row['atr']
        if not np.isnan(atr):
            if atr > last_row['close'] * 0.01:
                score += 15
            elif atr > last_row['close'] * 0.005:
                score += 8
        
        if signal_type == 'ACHAT' and not np.isnan(last_row['supports']):
            if abs(price - last_row['supports']) / price < 0.01:
                score += 15
        elif signal_type == 'VENTE' and not np.isnan(last_row['resistances']):
            if abs(price - last_row['resistances']) / price < 0.01:
                score += 15
        
        if not np.isnan(last_row['macd']) and not np.isnan(last_row['macd_signal']):
            if signal_type == 'ACHAT' and last_row['macd'] > last_row['macd_signal']:
                score += 10
            elif signal_type == 'VENTE' and last_row['macd'] < last_row['macd_signal']:
                score += 10
            elif signal_type == 'ACHAT' and last_row['macd'] > 0:
                score += 5
            elif signal_type == 'VENTE' and last_row['macd'] < 0:
                score += 5
        
        if not np.isnan(last_row['momentum']):
            if signal_type == 'ACHAT' and last_row['momentum'] > 0:
                score += 5
            elif signal_type == 'VENTE' and last_row['momentum'] < 0:
                score += 5
        
        confirmation_count = 0
        for tf_data in higher_timeframes:
            if signal_type == 'ACHAT' and tf_data['rsi'] < 35 and tf_data['ema_fast'] > tf_data['ema_slow'] and tf_data['macd'] > tf_data['macd_signal']:
                confirmation_count += 1
            elif signal_type == 'VENTE' and tf_data['rsi'] > 65 and tf_data['ema_fast'] < tf_data['ema_slow'] and tf_data['macd'] < tf_data['macd_signal']:
                confirmation_count += 1
        if confirmation_count >= 2:
            score += 10
        
        return min(score, 100)
    except Exception as e:
        return 0

# Générer des signaux
def generate_signals(df_1h, df_4h, df_1d, pair):
    if df_1h is None or df_4h is None or df_1d is None:
        return [], {'pair': pair, 'score': 0}
    
    signals = []
    last_row_1h = df_1h.iloc[-1]
    last_row_1d = df_1d.iloc[-1]
    price = last_row_1h['close']
    
    fib_levels_buy = ['fib_0.618', 'fib_0.5', 'fib_0.764']
    fib_levels_sell = ['fib_0.236', 'fib_0.382', 'fib_0.5']
    fib_proximity_buy = min([abs(price - last_row_1h[level]) / price for level in fib_levels_buy 
                             if not np.isnan(last_row_1h[level])], default=np.inf)
    fib_proximity_sell = min([abs(price - last_row_1h[level]) / price for level in fib_levels_sell 
                              if not np.isnan(last_row_1h[level])], default=np.inf)
    
    buy_strict = (
        (price <= last_row_1h['lower_bb']) and
        (last_row_1h['rsi'] < 30) and
        (last_row_1h['ema_fast'] > last_row_1h['ema_slow']) and
        (last_row_1h['macd'] > last_row_1h['macd_signal']) and
        (last_row_1h['momentum'] > 0) and
        (fib_proximity_buy < 0.02) and
        (not np.isnan(last_row_1d['supports']) and abs(price - last_row_1d['supports']) / price < 0.01)
    )
    sell_strict = (
        (price >= last_row_1h['upper_bb']) and
        (last_row_1h['rsi'] > 70) and
        (last_row_1h['ema_fast'] < last_row_1h['ema_slow']) and
        (last_row_1h['macd'] < last_row_1h['macd_signal']) and
        (last_row_1h['momentum'] < 0) and
        (fib_proximity_sell < 0.02) and
        (not np.isnan(last_row_1d['resistances']) and abs(price - last_row_1d['resistances']) / price < 0.01)
    )
    
    buy_medium = (
        (price <= last_row_1h['sma']) and
        (last_row_1h['rsi'] < 35) and
        (last_row_1h['ema_fast'] >= last_row_1h['ema_slow'] * 0.995) and
        (last_row_1h['macd'] > 0) and
        (last_row_1h['momentum'] > 0) and
        (fib_proximity_buy < 0.05)
    )
    sell_medium = (
        (price >= last_row_1h['sma']) and
        (last_row_1h['rsi'] > 65) and
        (last_row_1h['ema_fast'] <= last_row_1h['ema_slow'] * 1.005) and
        (last_row_1h['macd'] < 0) and
        (last_row_1h['momentum'] < 0) and
        (fib_proximity_sell < 0.05)
    )
    
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    atr = max(atr, last_row_1h['close'] * 0.005) * MIN_ATR_MULTIPLIER
    target_buy = price * (1 + TARGET_MOVE)
    target_sell = price * (1 - TARGET_MOVE)
    stop_loss_buy = price - atr
    stop_loss_sell = price + atr
    
    if not np.isnan(last_row_1d['supports']) and abs(target_buy - last_row_1d['supports']) / price < 0.005:
        target_buy = last_row_1d['supports'] * 0.98
    if not np.isnan(last_row_1d['resistances']) and abs(target_sell - last_row_1d['resistances']) / price < 0.005:
        target_sell = last_row_1d['resistances'] * 1.02
    
    higher_timeframes = [
        {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
         'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
         'macd_signal': df_4h.iloc[-1]['macd_signal'], 'momentum': df_4h.iloc[-1]['momentum']} if len(df_4h) > 0 else None,
        {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
         'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
         'macd_signal': df_1d.iloc[-1]['macd_signal'], 'momentum': df_1d.iloc[-1]['momentum']} if len(df_1d) > 0 else None
    ]
    higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
    
    signal_data = {
        'pair': pair,
        'price': round(price, 2),
        'target': None,
        'stop_loss': None,
        'rsi': round(last_row_1h['rsi'], 2) if not np.isnan(last_row_1h['rsi']) else None,
        'atr': round(atr, 2) if not np.isnan(atr) else None,
        'support': round(last_row_1d['supports'], 2) if not np.isnan(last_row_1d['supports']) else None,
        'resistance': round(last_row_1d['resistances'], 2) if not np.isnan(last_row_1d['resistances']) else None,
        'momentum': round(last_row_1h['momentum'], 2) if not np.isnan(last_row_1h['momentum']) else None,
        'confidence': None,
        'reason': None,
        'score': 0,
        'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
    }
    
    if buy_strict:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'ACHAT',
            'target': round(target_buy, 2),
            'stop_loss': round(stop_loss_buy, 2),
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger bas, RSI < 30, EMA haussier, MACD haussier, Momentum positif, Fibonacci + support 1d, confirmé 4h/1d)',
            'score': round(score, 1)
        })
    elif sell_strict:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'VENTE',
            'target': round(target_sell, 2),
            'stop_loss': round(stop_loss_sell, 2),
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger haut, RSI > 70, EMA baissier, MACD baissier, Momentum négatif, Fibonacci + résistance 1d, confirmé 4h/1d)',
            'score': round(score, 1)
        })
    elif buy_medium:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'ACHAT',
            'target': round(target_buy, 2),
            'stop_loss': round(stop_loss_buy, 2),
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sous SMA, RSI < 35, EMA neutre, MACD positif, Momentum positif, Fibonacci proche, partiellement confirmé 4h/1d)',
            'score': round(score, 1)
        })
    elif sell_medium:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'VENTE',
            'target': round(target_sell, 2),
            'stop_loss': round(stop_loss_sell, 2),
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sur SMA, RSI > 65, EMA neutre, MACD négatif, Momentum négatif, Fibonacci proche, partiellement confirmé 4h/1d)',
            'score': round(score, 1)
        })
    
    return signals, {
        **signal_data,
        'score': round(calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes), 1),
        'ema_trend': last_row_1h['ema_fast'] > last_row_1h['ema_slow'],
        'macd': round(last_row_1h['macd'], 2) if not np.isnan(last_row_1h['macd']) else None,
        'macd_signal': round(last_row_1h['macd_signal'], 2) if not np.isnan(last_row_1h['macd_signal']) else None,
        'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
    }

# Analyser un trade soumis
def analyze_trade(pair, entry_price, signal_type, df_1h, df_4h, df_1d):
    if df_1h is None or df_4h is None or df_1d is None:
        return {'type': 'error', 'message': 'Données insuffisantes pour l’analyse'}
    
    try:
        last_row_1h = df_1h.iloc[-1]
        last_row_1d = df_1d.iloc[-1]
        current_price = last_row_1h['close']
        atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
        atr = max(atr, last_row_1h['close'] * 0.005) * MIN_ATR_MULTIPLIER
        
        higher_timeframes = [
            {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
             'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
             'macd_signal': df_4h.iloc[-1]['macd_signal'], 'momentum': df_4h.iloc[-1]['momentum']} if len(df_4h) > 0 else None,
            {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
             'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
             'macd_signal': df_1d.iloc[-1]['macd_signal'], 'momentum': df_1d.iloc[-1]['momentum']} if len(df_1d) > 0 else None
        ]
        higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
        
        score = calculate_score(last_row_1h, signal_type, higher_timeframes)
        
        recommendation = 'Indécis'
        reason = []
        
        if signal_type == 'ACHAT':
            if not np.isnan(last_row_1d['supports']) and abs(current_price - last_row_1d['supports']) / current_price < 0.01:
                score += 10
                reason.append('Prix proche d’un support journalier solide')
            if last_row_1h['ema_fast'] > last_row_1h['ema_slow'] and last_row_1h['macd'] > last_row_1h['macd_signal']:
                score += 10
                reason.append('Tendance haussière confirmée (EMA et MACD)')
            if last_row_1h['rsi'] < 40:
                score += 5
                reason.append('RSI indique une zone de survente')
            stop_loss = entry_price - atr
            if current_price < stop_loss:
                recommendation = 'Vendre'
                reason.append('Prix sous le stop-loss recommandé')
            elif current_price > entry_price * 1.02:
                recommendation = 'Garder'
                reason.append('Prix au-dessus du seuil de profit (2%)')
            elif score > 70:
                recommendation = 'Garder'
                reason.append('Conditions techniques favorables')
            else:
                recommendation = 'Modifier'
                reason.append('Conditions mitigées, envisager d’ajuster le stop-loss')
        else:  # VENTE
            if not np.isnan(last_row_1d['resistances']) and abs(current_price - last_row_1d['resistances']) / current_price < 0.01:
                score += 10
                reason.append('Prix proche d’une résistance journalière solide')
            if last_row_1h['ema_fast'] < last_row_1h['ema_slow'] and last_row_1h['macd'] < last_row_1h['macd_signal']:
                score += 10
                reason.append('Tendance baissière confirmée (EMA et MACD)')
            if last_row_1h['rsi'] > 60:
                score += 5
                reason.append('RSI indique une zone de surachat')
            stop_loss = entry_price + atr
            if current_price > stop_loss:
                recommendation = 'Acheter (couvrir)'
                reason.append('Prix au-dessus du stop-loss recommandé')
            elif current_price < entry_price * 0.98:
                recommendation = 'Garder'
                reason.append('Prix en dessous du seuil de profit (2%)')
            elif score > 70:
                recommendation = 'Garder'
                reason.append('Conditions techniques favorables')
            else:
                recommendation = 'Modifier'
                reason.append('Conditions mitigées, envisager d’ajuster le stop-loss')
        
        return {
            'type': 'trade_analysis',
            'result': {
                'recommendation': recommendation,
                'reason': '; '.join(reason),
                'score': round(min(score, 100), 1),
                'current_price': round(current_price, 2),
                'support': round(last_row_1d['supports'], 2) if not np.isnan(last_row_1d['supports']) else None,
                'resistance': round(last_row_1d['resistances'], 2) if not np.isnan(last_row_1d['resistances']) else None,
                'rsi': round(last_row_1h['rsi'], 2) if not np.isnan(last_row_1h['rsi']) else None,
                'atr': round(atr, 2) if not np.isnan(atr) else None,
                'momentum': round(last_row_1h['momentum'], 2) if not np.isnan(last_row_1h['momentum']) else None,
                'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
            }
        }
    except Exception as e:
        return {'type': 'error', 'message': f'Erreur lors de l’analyse du trade: {str(e)}'}

# Forcer un trade
def force_trade(fallback_data):
    if not fallback_data:
        return None
    
    valid_fallbacks = [(f, df1, df2, df3) for f, df1, df2, df3 in fallback_data if df1 is not None and df2 is not None and df3 is not None]
    if not valid_fallbacks:
        return None
    
    valid_fallbacks = [
        (f, df1, df2, df3) for f, df1, df2, df3 in valid_fallbacks
        if f['score'] > 60 and not np.isnan(df3.iloc[-1]['supports']) and not np.isnan(df3.iloc[-1]['resistances'])
        and abs(df3.iloc[-1]['supports'] - df3.iloc[-1]['resistances']) / f['price'] > 0.01
    ]
    if not valid_fallbacks:
        return None
    
    best_fallback = max(valid_fallbacks, key=lambda x: x[0]['score'])
    pair = best_fallback[0]['pair']
    df_1h, df_4h, df_1d = best_fallback[1], best_fallback[2], best_fallback[3]
    
    last_row_1h = df_1h.iloc[-1]
    last_row_1d = df_1d.iloc[-1]
    price = last_row_1h['close']
    
    fib_levels_buy = ['fib_0.618', 'fib_0.5', 'fib_0.764']
    fib_levels_sell = ['fib_0.236', 'fib_0.382', 'fib_0.5']
    fib_proximity_buy = min([abs(price - last_row_1h[level]) / price for level in fib_levels_buy 
                             if not np.isnan(last_row_1h[level])], default=np.inf)
    fib_proximity_sell = min([abs(price - last_row_1h[level]) / price for level in fib_levels_sell 
                              if not np.isnan(last_row_1h[level])], default=np.inf)
    
    buy_forced = (
        (price <= last_row_1h['sma'] * 1.05) and
        (last_row_1h['rsi'] < 40) and
        (last_row_1h['ema_fast'] >= last_row_1h['ema_slow'] * 0.99) and
        (last_row_1h['macd'] >= 0) and
        (last_row_1h['momentum'] > 0) and
        (fib_proximity_buy < 0.1) and
        (not np.isnan(last_row_1d['supports']) and abs(price - last_row_1d['supports']) / price < 0.02) and
        (last_row_1h['atr'] > last_row_1h['close'] * 0.005)
    )
    sell_forced = (
        (price >= last_row_1h['sma'] * 0.95) and
        (last_row_1h['rsi'] > 60) and
        (last_row_1h['ema_fast'] <= last_row_1h['ema_slow'] * 1.01) and
        (last_row_1h['macd'] <= 0) and
        (last_row_1h['momentum'] < 0) and
        (fib_proximity_sell < 0.1) and
        (not np.isnan(last_row_1d['resistances']) and abs(price - last_row_1d['resistances']) / price < 0.02) and
        (last_row_1h['atr'] > last_row_1h['close'] * 0.005)
    )
    
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    atr = max(atr, last_row_1h['close'] * 0.005) * MIN_ATR_MULTIPLIER
    target_buy = price * (1 + TARGET_MOVE)
    target_sell = price * (1 - TARGET_MOVE)
    stop_loss_buy = price - atr
    stop_loss_sell = price + atr
    
    if not np.isnan(last_row_1d['supports']) and abs(target_buy - last_row_1d['supports']) / price < 0.005:
        target_buy = last_row_1d['supports'] * 0.98
    if not np.isnan(last_row_1d['resistances']) and abs(target_sell - last_row_1d['resistances']) / price < 0.005:
        target_sell = last_row_1d['resistances'] * 1.02
    
    higher_timeframes = [
        {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
         'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
         'macd_signal': df_4h.iloc[-1]['macd_signal'], 'momentum': df_4h.iloc[-1]['momentum']} if len(df_4h) > 0 else None,
        {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
         'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
         'macd_signal': df_1d.iloc[-1]['macd_signal'], 'momentum': df_1d.iloc[-1]['momentum']} if len(df_1d) > 0 else None
    ]
    higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
    
    signal_data = {
        'pair': pair,
        'price': round(price, 2),
        'target': None,
        'stop_loss': None,
        'rsi': round(last_row_1h['rsi'], 2) if not np.isnan(last_row_1h['rsi']) else None,
        'atr': round(atr, 2) if not np.isnan(atr) else None,
        'support': round(last_row_1d['supports'], 2) if not np.isnan(last_row_1d['supports']) else None,
        'resistance': round(last_row_1d['resistances'], 2) if not np.isnan(last_row_1d['resistances']) else None,
        'momentum': round(last_row_1h['momentum'], 2) if not np.isnan(last_row_1h['momentum']) else None,
        'confidence': 'Faible',
        'reason': None,
        'score': 0,
        'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
    }
    
    if buy_forced:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signal_data.update({
            'signal': 'ACHAT',
            'target': round(target_buy, 2),
            'stop_loss': round(stop_loss_buy, 2),
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI < 40, EMA neutre, MACD positif, Momentum positif, Fibonacci proche, support 1d proche, volatilité suffisante)',
            'score': round(score, 1)
        })
        return signal_data
    elif sell_forced:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signal_data.update({
            'signal': 'VENTE',
            'target': round(target_sell, 2),
            'stop_loss': round(stop_loss_sell, 2),
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI > 60, EMA neutre, MACD négatif, Momentum négatif, Fibonacci proche, résistance 1d proche, volatilité suffisante)',
            'score': round(score, 1)
        })
        return signal_data
    
    return None

# Main
def main():
    args = sys.argv[1:]
    if len(args) == 3:
        pair, entry_price, signal_type = args
        try:
            entry_price = float(entry_price)
            signal_type = signal_type.upper()
            if signal_type not in ['ACHAT', 'VENTE']:
                print(json.dumps({'type': 'error', 'message': 'Type de signal invalide (doit être ACHAT ou VENTE)'}))
                return
            if pair not in pairs:
                print(json.dumps({'type': 'error', 'message': f'Paire {pair} non supportée'}))
                return
            ohlcv_1h = kraken.fetch_ohlcv(pair, timeframe='1h', limit=LIMIT)
            ohlcv_4h = kraken.fetch_ohlcv(pair, timeframe='4h', limit=LIMIT)
            ohlcv_1d = kraken.fetch_ohlcv(pair, timeframe='1d', limit=LIMIT)
            df_1h = pd.DataFrame(ohlcv_1h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_4h = pd.DataFrame(ohlcv_4h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_1d = pd.DataFrame(ohlcv_1d, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_1h = calculate_indicators(df_1h)
            df_4h = calculate_indicators(df_4h)
            df_1d = calculate_indicators(df_1d)
            if df_1h is None or df_4h is None or df_1d is None:
                print(json.dumps({'type': 'error', 'message': 'Données insuffisantes pour l’analyse'}))
                return
            result = analyze_trade(pair, entry_price, signal_type, df_1h, df_4h, df_1d)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({'type': 'error', 'message': f'Erreur lors de l’analyse du trade: {str(e)}'}))
        return
    
    try:
        markets = kraken.load_markets()
        valid_pairs = [p for p in pairs if p in markets]
        if not valid_pairs:
            print(json.dumps({'type': 'error', 'message': 'Aucune paire valide disponible'}))
            return
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': f'Erreur lors de la vérification des paires: {str(e)}'}))
        return
    
    all_signals = []
    fallback_data = []
    
    for pair in valid_pairs:
        try:
            dfs = {}
            for tf in TIMEFRAMES:
                ohlcv = kraken.fetch_ohlcv(pair, timeframe=tf, limit=LIMIT)
                df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                df = calculate_indicators(df)
                if df is None:
                    break
                dfs[tf] = df
                time.sleep(0.2)
            else:
                signals, fallback = generate_signals(dfs['1h'], dfs['4h'], dfs['1d'], pair)
                all_signals.extend(signals)
                fallback_data.append((fallback, dfs['1h'], dfs['4h'], dfs['1d']))
        except Exception as e:
            pass  # Skip silently
    
    if all_signals:
        best_signal = max(all_signals, key=lambda x: x['score'])
    else:
        best_signal = force_trade(fallback_data)
    
    if best_signal:
        print(json.dumps({
            'type': 'best_signal',
            'result': {
                'pair': best_signal['pair'],
                'signal': best_signal['signal'],
                'price': best_signal['price'],
                'target': best_signal['target'],
                'stop_loss': best_signal['stop_loss'],
                'rsi': best_signal['rsi'],
                'atr': best_signal['atr'],
                'support': best_signal['support'],
                'resistance': best_signal['resistance'],
                'confidence': best_signal['confidence'],
                'score': best_signal['score'],
                'reason': best_signal['reason'],
                'price_history': best_signal.get('price_history', [])
            }
        }))
    else:
        print(json.dumps({'type': 'error', 'message': 'Aucun trade possible (vérifiez les données ou paires)'}))
    
if __name__ == "__main__":
    main()
```
