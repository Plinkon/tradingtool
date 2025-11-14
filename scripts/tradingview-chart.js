// tradingview-chart.js
// Reusable, UI-free wrapper around TradingView's Lightweight Charts.
// Features:
//  - Accepts OHLC or OHLCV (objects or arrays) with flexible mapping
//  - Parses "YYYY-MM-DD HH:MM:SS+00:00" / ISO / Unix; auto-index fallback
//  - Locks left edge (no blank space before first candle)
//  - Order overlays: Entry / SL / TP with markers
//  - DRAGGABLE Entry/SL/TP; programmatic control & change subscriptions
//  - Freezes chart viewport while dragging to avoid unintentional pan/zoom

export default async function createCandleChart(container, options = {}) {
  const LW = await ensureLightweightCharts(options.libraryUrl);
  const el = resolveContainer(container);

  const {
    autoSize = true,
    width,
    height = 420,
    layout = {},
    grid = {},
    crosshair = { mode: LW.CrosshairMode.Normal },
    rightPriceScale = { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.2 } },
    timeScale = { borderVisible: false, timeVisible: true, secondsVisible: false },
    candleSeries: candleStyle = {},
    volumeSeries: volumeStyle = { priceFormat: { type: 'volume' }, priceScaleId: '', overlay: true, scaleMargins: { top: 0.8, bottom: 0 } },
    initialData = [],
    dataMapping = undefined,      // for object rows
    arrayMapping = undefined,     // for array rows: { time, open, high, low, close, volume }
    skipLeadingHeaderRows = 0,    // for CSV arrays with header lines
    fixLeftEdge = true,

    // Interaction config
    handleScroll = { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale  = { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true } },

    // Drag behavior
    dragThresholdPx = 6,
    snapTick = null,              // optional: (price)=>snappedPrice (e.g., 0.01 tick)
    //follow behavior on updates: 'never' | 'ifPinned' | 'always'
    followLatestOnUpdate = 'ifPinned',
  } = options;

  function _isPinnedRight() {
    const pos = chart.timeScale().scrollPosition?.();
    // 0 means exactly at the last bar; near-zero ≈ pinned
    return typeof pos === 'number' ? Math.abs(pos) < 0.1 : false;
    }


  const baseInteraction = { handleScroll, handleScale };

  const chart = LW.createChart(el, {
    autoSize,
    width: autoSize ? undefined : width || el.clientWidth,
    height,
    layout: { background: { type: 'solid', color: '#000000ff' }, textColor: '#d6e2f0', attributionLogo: false, ...layout },
    grid: { horzLines: { color: '#2d2d2dff', style: 1 }, vertLines: { color: '#2d2d2dff', style: 1 }, ...grid },
    crosshair,
    rightPriceScale,
    timeScale,
    handleScroll,
    handleScale,
  });

  if (fixLeftEdge) chart.timeScale().applyOptions({ fixLeftEdge: true });

  const candleDefaults = {
    upColor: '#22c55e',
    downColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    borderVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  };
  const candle = chart.addCandlestickSeries({ ...candleDefaults, ...candleStyle });
  const vol = chart.addHistogramSeries({ ...volumeStyle });

  // ---------- Data API ----------
  const resetView = () => {
    // --- Time scale reset ---
    const timeScale = chart.timeScale();
    timeScale.fitContent();
    timeScale.applyOptions({ fixLeftEdge: true });
    timeScale.scrollToRealTime();

    // --- Price scale reset (this is what you're missing) ---
    // Use the series' price scale so this stays correct even if you change priceScaleId later
    const priceScale = candle.priceScale();

    priceScale.applyOptions({
      autoScale: true,          // re-enable autoscale so it follows visible bars
      // keep your existing margins so the look stays consistent
      scaleMargins: rightPriceScale.scaleMargins ?? { top: 0.1, bottom: 0.2 },
    });
  };


  const setData = (rows) => {
    const bars = normalizeBars(rows, { dataMapping, arrayMapping, skipLeadingHeaderRows })
      .sort((a, b) => a.time - b.time);
    candle.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const volPoints = bars.map(volumePoint).filter(Boolean);
    vol.setData(volPoints);
  };

  const update = (bar) => {
    const [b] = normalizeBars([bar], { dataMapping, arrayMapping, skipLeadingHeaderRows: 0 });
    if (!b) return;
    candle.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
    const shouldFollow =
    followLatestOnUpdate === 'always' ||
    (followLatestOnUpdate === 'ifPinned' && _isPinnedRight());

    if (shouldFollow && chart.timeScale().scrollToRealTime) {
    chart.timeScale().scrollToRealTime();
    }

    const vp = volumePoint(b);
    if (vp) vol.update(vp);
  };

  if (initialData && initialData.length) {
    setData(initialData);
    //chart.timeScale().fitContent();
  }

  // ---------- Orders (with dragging) ----------
  const BUY  = { color: '#22c55e' };
  const SELL = { color: '#ef4444' };
  const DASH = LW.LineStyle.Dashed;

  let _markers = [];               // series markers
  const _orders = new Map();       // id -> { entryLine, slLine?, tpLine?, marker, meta }
  let _nextOrderId = 1;

  function _applyMarkers() {
    _markers.sort((a, b) => a.time - b.time);
    candle.setMarkers(_markers);
  }
  function _makeEntryLine({ price, side, label }) {
    return candle.createPriceLine({
      price,
      color: side === 'buy' ? BUY.color : SELL.color,
      lineStyle: LW.LineStyle.Solid,
      lineWidth: 2,
      axisLabelVisible: true,
      title: label ?? (side === 'buy' ? 'BUY' : 'SELL'),
    });
  }
  function _makeSL({ price }) {
    return candle.createPriceLine({ price, color: SELL.color, lineStyle: DASH, lineWidth: 2, axisLabelVisible: true, title: 'SL' });
  }
  function _makeTP({ price }) {
    return candle.createPriceLine({ price, color: BUY.color,  lineStyle: DASH, lineWidth: 2, axisLabelVisible: true, title: 'TP' });
  }

  function placeOrder({ time, price, side = 'buy', sl, tp, label }) {
    if (time == null || price == null) throw new Error('placeOrder: time and price are required');
    const id = _nextOrderId++;
    console.log("side: ", side);
    const marker = {
      time,
      position: side === 'buy' ? 'belowBar' : 'aboveBar',
      color: side === 'buy' ? BUY.color : SELL.color,
      shape: side === 'buy' ? 'arrowUp' : 'arrowDown',
      //text: label ?? (side === 'buy' ? `Buy ${price}` : `Sell ${price}`),
    };
    _markers.push(marker); _applyMarkers();
    const entryLine = _makeEntryLine({ price, side, label });
    const slLine = sl != null ? _makeSL({ price: sl }) : null;
    const tpLine = tp != null ? _makeTP({ price: tp }) : null;
    _orders.set(id, { entryLine, slLine, tpLine, marker, meta: { time, price, side, sl, tp, label } });
    return id;
  }

  function updateOrder(id, patch = {}) {
    const rec = _orders.get(id); if (!rec) return false;
    const changed = [];
    if (patch.price != null) { rec.entryLine.applyOptions({ price: patch.price }); rec.meta.price = patch.price; changed.push('price'); }
    if (patch.sl    != null) { if (!rec.slLine) rec.slLine = _makeSL({ price: patch.sl }); else rec.slLine.applyOptions({ price: patch.sl }); rec.meta.sl = patch.sl; changed.push('sl'); }
    if (patch.tp    != null) { if (!rec.tpLine) rec.tpLine = _makeTP({ price: patch.tp }); else rec.tpLine.applyOptions({ price: patch.tp }); rec.meta.tp = patch.tp; changed.push('tp'); }
    if (patch.time  != null) { rec.meta.time = patch.time; rec.marker.time = patch.time; _applyMarkers(); changed.push('time'); }
    if (patch.side) {
      rec.meta.side = patch.side;
      const side = patch.side;
      rec.entryLine.applyOptions({ color: side === 'buy' ? BUY.color : SELL.color, title: rec.meta.label ?? (side === 'buy' ? 'BUY' : 'SELL') });
      rec.marker.position = side === 'buy' ? 'belowBar' : 'aboveBar';
      rec.marker.color = side === 'buy' ? BUY.color : SELL.color;
      _applyMarkers();
      changed.push('side');
    }
    if (patch.label) { rec.meta.label = patch.label; rec.entryLine.applyOptions({ title: patch.label }); rec.marker.text = patch.label; _applyMarkers(); changed.push('label'); }
    if (changed.length) _emitChange(id, changed);
    return true;
  }

  function cancelOrder(id) {
    const rec = _orders.get(id); if (!rec) return false;
    if (rec.entryLine) candle.removePriceLine(rec.entryLine);
    if (rec.slLine) candle.removePriceLine(rec.slLine);
    if (rec.tpLine) candle.removePriceLine(rec.tpLine);
    const idx = _markers.indexOf(rec.marker); if (idx >= 0) { _markers.splice(idx, 1); _applyMarkers(); }
    _orders.delete(id); _emitChange(id, ['cancel']); return true;
  }

  function listOrders() { return Array.from(_orders.entries()).map(([id, { meta }]) => ({ id, ...meta })); }
  function getOrder(id) { const rec = _orders.get(id); return rec ? ({ id, ...rec.meta }) : null; }

  // Subscriptions
  const listeners = new Set();
  function _emitChange(id, changedFields) {
    const rec = _orders.get(id); if (!rec) return;
    const payload = { id, ...rec.meta, changed: changedFields };
    listeners.forEach(fn => { try { fn(payload); } catch {} });
  }
  function onOrderChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // ---------- Dragging ----------
  let drag = { active: false, id: null, target: null }; // target: 'entry' | 'sl' | 'tp'
  let pointerCaptured = false;
  let frozen = false;

  function freezeViewport() {
    if (frozen) return;
    frozen = true;
    chart.applyOptions({
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
      handleScale:  { mouseWheel: false, pinch: false, axisPressedMouseMove: { time: false, price: false } },
    });
  }
  function unfreezeViewport() {
    if (!frozen) return;
    frozen = false;
    chart.applyOptions({ handleScroll: baseInteraction.handleScroll, handleScale: baseInteraction.handleScale });
  }

  function _nearestHandle(yPx) {
    let best = null;
    for (const [id, rec] of _orders) {
      const tests = [
        ['sl',    rec.meta.sl,    rec.slLine],
        ['tp',    rec.meta.tp,    rec.tpLine],
      ];
      for (const [target, price, line] of tests) {
        if (!line || price == null) continue;
        const lineY = candle.priceToCoordinate(price);
        if (lineY == null) continue;
        const dist = Math.abs(lineY - yPx);
        if (dist <= dragThresholdPx && (!best || dist < best.dist)) best = { id, target, dist };
      }
    }
    return best;
  }
  function _priceFromY(yPx) {
    const p = candle.coordinateToPrice(yPx);
    if (typeof p !== 'number') return null;
    return snapTick ? snapTick(p) : p;
  }
  function _setCursorOverHandle(yPx) {
    el.style.cursor = _nearestHandle(yPx) ? 'ns-resize' : '';
  }
  function _startDrag(yPx) {
    const hit = _nearestHandle(yPx);
    if (!hit) return;
    drag = { active: true, id: hit.id, target: hit.target };
    el.style.cursor = 'ns-resize';
    freezeViewport();
  }
  function _updateDrag(yPx) {
    if (!drag.active) return;
    const price = _priceFromY(yPx);
    if (price == null) return;
    const rec = _orders.get(drag.id);
    if (!rec) return;
    if (drag.target === 'sl') {
      if (!rec.slLine) rec.slLine = _makeSL({ price }); else rec.slLine.applyOptions({ price });
      rec.meta.sl = price; _emitChange(drag.id, ['sl']);
    } else if (drag.target === 'tp') {
      if (!rec.tpLine) rec.tpLine = _makeTP({ price }); else rec.tpLine.applyOptions({ price });
      rec.meta.tp = price; _emitChange(drag.id, ['tp']);
    }
  }
  function _endDrag() {
    if (!drag.active) return;
    drag = { active: false, id: null, target: null };
    el.style.cursor = '';
    unfreezeViewport();
  }

  const onPointerMove  = (ev) => { const r = el.getBoundingClientRect(); const y = ev.clientY - r.top; if (!drag.active) _setCursorOverHandle(y); else _updateDrag(y); };
  const onPointerDown  = (ev) => { const r = el.getBoundingClientRect(); const y = ev.clientY - r.top; _startDrag(y); if (drag.active && !pointerCaptured) { pointerCaptured = true; el.setPointerCapture(ev.pointerId); } };
  const onPointerUp    = (ev) => { if (pointerCaptured) { el.releasePointerCapture(ev.pointerId); pointerCaptured = false; } _endDrag(); };
  const onPointerLeave = () => { _endDrag(); };

  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointerleave', onPointerLeave);

  // ---------- Resize ----------
    let ro = null;
    if (autoSize && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
        // Do NOT fit here; lightweight-charts preserves logical range on resize.
        // If you want to keep following latest only when pinned, do nothing here.
    });
    ro.observe(el);
    }


  const fit = () => chart.timeScale().fitContent();
  const setPriceLine = (opts) => candle.createPriceLine(opts);
  const addLineSeries = (style = {}) => chart.addLineSeries(style);
  const setColors = ({ up = '#22c55e', down = '#ef4444' } = {}) =>
    candle.applyOptions({ upColor: up, wickUpColor: up, downColor: down, wickDownColor: down });
  const destroy = () => {
    ro && ro.disconnect();
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointerleave', onPointerLeave);
    chart.remove();
  };

  return {
    chart, candle, volume: vol,
    setData, update, /*fit,*/ setPriceLine, addLineSeries, setColors, destroy, resetView,
    // Orders API
    placeOrder, updateOrder, cancelOrder, listOrders, getOrder, onOrderChange,
  };
}

// ------------- Helpers -------------
async function ensureLightweightCharts(url = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js') {
  if (typeof window !== 'undefined' && window.LightweightCharts) return window.LightweightCharts;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url; script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Lightweight Charts library.'));
    document.head.appendChild(script);
  });
  if (!window.LightweightCharts) throw new Error('LightweightCharts not available after load.');
  return window.LightweightCharts;
}

function resolveContainer(container) {
  if (typeof container === 'string') {
    const el = document.querySelector(container);
    if (!el) throw new Error(`Container not found: ${container}`);
    return el;
  }
  if (container && container.nodeType === 1) return container;
  throw new Error('Invalid container. Use a selector or HTMLElement.');
}

function firstKey(obj, candidates) { for (const k of candidates) if (obj[k] !== undefined) return obj[k]; return undefined; }

function coerceNumber(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const s = v.replace(/[$,\s]/g, ''); const n = Number(s); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}

function toSeconds(val) {
  if (val == null || val === '') return undefined;
  if (typeof val === 'number') return val > 1e11 ? Math.floor(val / 1000) : Math.floor(val);
  if (typeof val === 'string') {
    // Normalize "YYYY-MM-DD HH:MM:SS+00:00" -> "YYYY-MM-DDTHH:MM:SS+0000"
    const s = val.trim().replace(' ', 'T').replace(/(\+\d{2}):?(\d{2})$/, '+$1$2');
    const t = Date.parse(s);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }
  return undefined;
}

// Normalize rows: supports object rows or array rows.
// options: { dataMapping, arrayMapping, skipLeadingHeaderRows }
function normalizeBars(rows, options = {}) {
  if (!Array.isArray(rows)) return [];
  const { dataMapping, arrayMapping, skipLeadingHeaderRows = 0 } = options;

  const map = {
    time:   ['time','t','timestamp','date','datetime','Datetime','Date'],
    open:   ['open','o','Open'],
    high:   ['high','h','High'],
    low:    ['low','l','Low'],
    close:  ['close','c','Close','Close/Last','Price'],
    volume: ['volume','v','vol','Volume'],
    ...(dataMapping || {})
  };

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (i < skipLeadingHeaderRows) continue;
    const r = rows[i];

    let rec;
    if (Array.isArray(r)) {
      const idx = arrayMapping || { time: 0, open: 4, high: 2, low: 3, close: 1, volume: 5 };
      let time = toSeconds(r[idx.time]); if (!Number.isFinite(time)) time = out.length;
      const open  = coerceNumber(r[idx.open]);
      const high  = coerceNumber(r[idx.high]);
      const low   = coerceNumber(r[idx.low]);
      const close = coerceNumber(r[idx.close]);
      const volume= coerceNumber(r[idx.volume]);
      rec = { time, open, high, low, close, volume };
    } else if (typeof r === 'object' && r) {
      let time = toSeconds(firstKey(r, map.time)); if (!Number.isFinite(time)) time = out.length;
      const open  = coerceNumber(firstKey(r, map.open));
      const high  = coerceNumber(firstKey(r, map.high));
      const low   = coerceNumber(firstKey(r, map.low));
      const close = coerceNumber(firstKey(r, map.close));
      const volume= coerceNumber(firstKey(r, map.volume));
      rec = { time, open, high, low, close, volume };
    } else continue;

    if ([rec.open, rec.high, rec.low, rec.close].every(Number.isFinite)) out.push(rec);
  }
  return out;
}

function volumePoint({ time, open, close, volume }) {
  if (volume == null) return null;
  const up = close >= open;
  return { time, value: volume, color: up ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)' };
}

export { createCandleChart }; // optional named export for symmetry
