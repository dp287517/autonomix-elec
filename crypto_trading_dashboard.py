import os
import ccxt
import pandas as pd
import numpy as np
from datetime import datetime
import time
import warnings
import json
import sys
warnings.filterwarnings("ignore")

# Configuration de l'API Kraken
kraken = ccxt.kraken({
    'apiKey': os.getenv('KRAKEN_API_KEY'),
    'secret': os.getenv('KRAKEN_SECRET'),
})

# Paires confirmées
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

# Calcul des indicateurs
def calculate_indicators(df):
    if df.empty or len(df) < max(BB_PERIOD, RSI_PERIOD, EMA_SLOW, MOMENTUM_PERIOD):
        return None
    
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
    
    # Supports et résistances sur 1d
    supports = []
    resistances = []
    for i in range(2, len(df) - 2):
        if df['low'].iloc[i] < df['low'].iloc[i-1] and df['low'].iloc[i] < df['low'].iloc[i+1]:
            supports.append(df['low'].iloc[i])
        if df['high'].iloc[i] > df['high'].iloc[i-1] and df['high'].iloc[i] > df['high'].iloc[i+1]:
            resistances.append(df['high'].iloc[i])
    df['supports'] = [min(supports, default=np.nan, key=lambda x: abs(x - df['close'].iloc[-1]))] * len(df) if supports else [np.nan] * len(df)
    df['resistances'] = [min(resistances, default=np.nan, key=lambda x: abs(x - df['close'].iloc[-1]))] * len(df) if resistances else [np.nan] * len(df)
    
    return df

# Calcul du score
def calculate_score(last_row, signal_type, higher_timeframes=None):
    if higher_timeframes is None:
        higher_timeframes = []
    
    score = 0
    price = last_row['close']
    
    # RSI (15%)
    rsi = last_row['rsi']
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
    
    # Bollinger (15%)
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
    
    # EMA (15%)
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
    
    # Fibonacci (15%)
    fib_levels = ['fib_0.236', 'fib_0.382', 'fib_0.5', 'fib_0.618', 'fib_0.764']
    fib_proximities = [abs(price - last_row[level]) / price for level in fib_levels if not np.isnan(last_row[level])]
    fib_proximity = min(fib_proximities, default=np.inf)
    if fib_proximity < 0.02:
        score += 15
    elif fib_proximity < 0.05:
        score += 8
    
    # ATR (15%)
    atr = last_row['atr']
    if atr > last_row['close'] * 0.01:
        score += 15
    elif atr > last_row['close'] * 0.005:
        score += 8
    
    # Support/Résistance (15%)
    if signal_type == 'ACHAT' and not np.isnan(last_row['supports']):
        if abs(price - last_row['supports']) / price < 0.01:
            score += 15
    elif signal_type == 'VENTE' and not np.isnan(last_row['resistances']):
        if abs(price - last_row['resistances']) / price < 0.01:
            score += 15
    
    # MACD (10%)
    if signal_type == 'ACHAT' and last_row['macd'] > last_row['macd_signal']:
        score += 10
    elif signal_type == 'VENTE' and last_row['macd'] < last_row['macd_signal']:
        score += 10
    elif signal_type == 'ACHAT' and last_row['macd'] > 0:
        score += 5
    elif signal_type == 'VENTE' and last_row['macd'] < 0:
        score += 5
    
    # Momentum (5%)
    if signal_type == 'ACHAT' and last_row['momentum'] > 0:
        score += 5
    elif signal_type == 'VENTE' and last_row['momentum'] < 0:
        score += 5
    
    # Multi-timeframe (bonus +10)
    confirmation_count = 0
    for tf_data in higher_timeframes:
        if signal_type == 'ACHAT' and tf_data['rsi'] < 35 and tf_data['ema_fast'] > tf_data['ema_slow'] and tf_data['macd'] > tf_data['macd_signal']:
            confirmation_count += 1
        elif signal_type == 'VENTE' and tf_data['rsi'] > 65 and tf_data['ema_fast'] < tf_data['ema_slow'] and tf_data['macd'] < tf_data['macd_signal']:
            confirmation_count += 1
    if confirmation_count >= 2:
        score += 10
    
    return min(score, 100)

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
    
    # Niveau 1 : Strict (1h avec supports/résistances 1d)
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
    
    # Niveau 2 : Moyen
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
    target_buy = price * (1 + TARGET_MOVE)
    target_sell = price * (1 - TARGET_MOVE)
    stop_loss_buy = price - atr * 1.5
    stop_loss_sell = price + atr * 1.5
    
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
        'price': price,
        'target': None,
        'stop_loss': None,
        'rsi': last_row_1h['rsi'],
        'atr': atr,
        'support': last_row_1d['supports'] if not np.isnan(last_row_1d['supports']) else None,
        'resistance': last_row_1d['resistances'] if not np.isnan(last_row_1d['resistances']) else None,
        'momentum': last_row_1h['momentum'],
        'confidence': None,
        'reason': None,
        'score': 0
    }
    
    if buy_strict:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'ACHAT',
            'target': target_buy,
            'stop_loss': stop_loss_buy,
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger bas, RSI < 30, EMA haussier, MACD haussier, Momentum positif, Fibonacci + support 1d, confirmé 4h/1d)',
            'score': score
        })
    elif sell_strict:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'VENTE',
            'target': target_sell,
            'stop_loss': stop_loss_sell,
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger haut, RSI > 70, EMA baissier, MACD baissier, Momentum négatif, Fibonacci + résistance 1d, confirmé 4h/1d)',
            'score': score
        })
    elif buy_medium:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'ACHAT',
            'target': target_buy,
            'stop_loss': stop_loss_buy,
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sous SMA, RSI < 35, EMA neutre, MACD positif, Momentum positif, Fibonacci proche, partiellement confirmé 4h/1d)',
            'score': score
        })
    elif sell_medium:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'VENTE',
            'target': target_sell,
            'stop_loss': stop_loss_sell,
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sur SMA, RSI > 65, EMA neutre, MACD négatif, Momentum négatif, Fibonacci proche, partiellement confirmé 4h/1d)',
            'score': score
        })
    
    return signals, {
        **signal_data,
        'score': calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes),
        'ema_trend': last_row_1h['ema_fast'] > last_row_1h['ema_slow'],
        'macd': last_row_1h['macd'],
        'macd_signal': last_row_1h['macd_signal'],
        'price_history': df_1h[['timestamp', 'close', 'supports', 'resistances']].tail(50).to_dict(orient='records')
    }

# Analyser un trade soumis
def analyze_trade(pair, entry_price, signal_type, df_1h, df_4h, df_1d):
    if df_1h is None or df_4h is None or df_1d is None:
        return {'recommendation': 'Indécis', 'reason': 'Données insuffisantes', 'score': 0}
    
    last_row_1h = df_1h.iloc[-1]
    last_row_1d = df_1d.iloc[-1]
    current_price = last_row_1h['close']
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    
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
    
    # Évaluation du trade
    recommendation = 'Indécis'
    reason = []
    
    if signal_type == 'ACHAT':
        # Prix proche d’un support journalier
        if not np.isnan(last_row_1d['supports']) and abs(current_price - last_row_1d['supports']) / current_price < 0.01:
            score += 10
            reason.append('Prix proche d’un support journalier solide')
        # Tendance haussière
        if last_row_1h['ema_fast'] > last_row_1h['ema_slow'] and last_row_1h['macd'] > last_row_1h['macd_signal']:
            score += 10
            reason.append('Tendance haussière confirmée (EMA et MACD)')
        # RSI favorable
        if last_row_1h['rsi'] < 40:
            score += 5
            reason.append('RSI indique une zone de survente')
        # Proximité du stop-loss
        stop_loss = entry_price - atr * 1.5
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
        # Prix proche d’une résistance journalière
        if not np.isnan(last_row_1d['resistances']) and abs(current_price - last_row_1d['resistances']) / current_price < 0.01:
            score += 10
            reason.append('Prix proche d’une résistance journalière solide')
        # Tendance baissière
        if last_row_1h['ema_fast'] < last_row_1h['ema_slow'] and last_row_1h['macd'] < last_row_1h['macd_signal']:
            score += 10
            reason.append('Tendance baissière confirmée (EMA et MACD)')
        # RSI favorable
        if last_row_1h['rsi'] > 60:
            score += 5
            reason.append('RSI indique une zone de surachat')
        # Proximité du stop-loss
        stop_loss = entry_price + atr * 1.5
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
        'recommendation': recommendation,
        'reason': '; '.join(reason),
        'score': min(score, 100),
        'current_price': current_price,
        'support': last_row_1d['supports'] if not np.isnan(last_row_1d['supports']) else None,
        'resistance': last_row_1d['resistances'] if not np.isnan(last_row_1d['resistances']) else None,
        'rsi': last_row_1h['rsi'],
        'atr': atr,
        'momentum': last_row_1h['momentum'],
        'price_history': df_1h[['timestamp', 'close', 'supports', 'resistances']].tail(50).to_dict(orient='records')
    }

# Forcer un trade
def force_trade(fallback_data):
    if not fallback_data:
        return None
    
    valid_fallbacks = [(f, df1, df2, df3) for f, df1, df2, df3 in fallback_data if df1 is not None and df2 is not None and df3 is not None]
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
    target_buy = price * (1 + TARGET_MOVE)
    target_sell = price * (1 - TARGET_MOVE)
    stop_loss_buy = price - atr * 1.5
    stop_loss_sell = price + atr * 1.5
    
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
        'price': price,
        'target': None,
        'stop_loss': None,
        'rsi': last_row_1h['rsi'],
        'atr': atr,
        'support': last_row_1d['supports'] if not np.isnan(last_row_1d['supports']) else None,
        'resistance': last_row_1d['resistances'] if not np.isnan(last_row_1d['resistances']) else None,
        'momentum': last_row_1h['momentum'],
        'confidence': 'Faible',
        'reason': None,
        'score': 0,
        'price_history': df_1h[['timestamp', 'close', 'supports', 'resistances']].tail(50).to_dict(orient='records')
    }
    
    if buy_forced:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signal_data.update({
            'signal': 'ACHAT',
            'target': target_buy,
            'stop_loss': stop_loss_buy,
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI < 40, EMA neutre, MACD positif, Momentum positif, Fibonacci proche, support 1d proche, volatilité suffisante)',
            'score': score
        })
        return signal_data
    elif sell_forced:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signal_data.update({
            'signal': 'VENTE',
            'target': target_sell,
            'stop_loss': stop_loss_sell,
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI > 60, EMA neutre, MACD négatif, Momentum négatif, Fibonacci proche, résistance 1d proche, volatilité suffisante)',
            'score': score
        })
        return signal_data
    
    score = calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes) * 0.5 + \
            (calculate_score(df_4h.iloc[-1], 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
            (calculate_score(df_1d.iloc[-1], 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
    signal_data.update({
        'signal': 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE',
        'target': target_buy if last_row_1h['rsi'] < 50 else target_sell,
        'stop_loss': stop_loss_buy if last_row_1h['rsi'] < 50 else stop_loss_sell,
        'reason': 'Trade forcé (meilleur score global basé sur tous les indicateurs, partiellement confirmé 4h/1d)',
        'score': score
    })
    return signal_data

# Main
def main():
    # Vérifier si un trade est soumis via arguments
    args = sys.argv[1:]
    if len(args) == 3:
        pair, entry_price, signal_type = args
        entry_price = float(entry_price)
        try:
            ohlcv_1h = kraken.fetch_ohlcv(pair, timeframe='1h', limit=LIMIT)
            ohlcv_4h = kraken.fetch_ohlcv(pair, timeframe='4h', limit=LIMIT)
            ohlcv_1d = kraken.fetch_ohlcv(pair, timeframe='1d', limit=LIMIT)
            df_1h = pd.DataFrame(ohlcv_1h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_4h = pd.DataFrame(ohlcv_4h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_1d = pd.DataFrame(ohlcv_1d, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_1h = calculate_indicators(df_1h)
            df_4h = calculate_indicators(df_4h)
            df_1d = calculate_indicators(df_1d)
            result = analyze_trade(pair, entry_price, signal_type.upper(), df_1h, df_4h, df_1d)
            print(json.dumps({'type': 'trade_analysis', 'result': result}))
        except Exception as e:
            print(json.dumps({'type': 'error', 'message': str(e)}))
        return
    
    # Analyse standard
    print("Analyse des cryptos pour trading intraday (levier x50 sur Kraken)")
    print(f"Date/Heure: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 80)
    
    try:
        markets = kraken.load_markets()
        valid_pairs = [p for p in pairs if p in markets]
        if not valid_pairs:
            print(json.dumps({'type': 'error', 'message': 'Aucune paire valide disponible'}))
            return
        print(f"Paires valides: {valid_pairs}")
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
                    print(f"Données insuffisantes pour {pair} ({tf})")
                    break
                dfs[tf] = df
                time.sleep(1)
            else:
                signals, fallback = generate_signals(dfs['1h'], dfs['4h'], dfs['1d'], pair)
                all_signals.extend(signals)
                fallback_data.append((fallback, dfs['1h'], dfs['4h'], dfs['1d']))
        except Exception as e:
            print(f"Erreur pour {pair}: {e}")
    
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
    
    print("\nConseil: Relancez demain pour un nouveau trade.")

if __name__ == "__main__":
    main()
