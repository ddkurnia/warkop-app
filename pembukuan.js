/**
 * ============================================================
 * WARKOPOS - MODUL PEMBUKUAN
 * ============================================================
 * Sistem pembukuan terintegrasi dengan POS
 * 
 * Fitur:
 *  - Stok (Inventory CRUD)
 *  - Produksi (Bahan → Produk)
 *  - Pengeluaran (CRUD + Kategori)
 *  - Penjualan (Read-only dari POS)
 *  - Laporan (Harian & Bulanan, Profit)
 * 
 * Data: localStorage dengan key warkop_{module}_{uid}
 * Arsitektur: IIFE Module Pattern (non-invasive)
 * ============================================================
 */
var Pembukuan = (function() {
  'use strict';

  // =============================================
  // STATE
  // =============================================
  var _currentPage = 'stok';
  var _uid = null;
  var _inventory = [];
  var _production = [];
  var _expenses = [];
  var _salesCache = null;
  var _reportDate = null;
  var _reportPeriod = 'daily';
  var _initialized = false;

  // =============================================
  // CONSTANTS
  // =============================================
  var LS = {
    inventory: function(uid) { return 'warkop_inventory_' + uid; },
    production: function(uid) { return 'warkop_production_' + uid; },
    expenses: function(uid) { return 'warkop_expenses_' + uid; },
    appMode: 'warkop_app_mode'
  };

  var EXPENSE_CATS = [
    { id: 'bahan_baku', label: 'Bahan Baku', color: 'amber', icon: 'fa-box-open' },
    { id: 'operasional', label: 'Operasional', color: 'blue', icon: 'fa-wrench' },
    { id: 'lainnya', label: 'Lainnya', color: 'slate', icon: 'fa-ellipsis' }
  ];

  var STOCK_CATS = [
    { id: 'bahan_baku', label: 'Bahan Baku' },
    { id: 'produk_jadi', label: 'Produk Jadi' },
    { id: 'lainnya', label: 'Lainnya' }
  ];

  var UNITS = ['pcs', 'kg', 'gram', 'liter', 'ml', 'butir', 'pack', 'bungkus', 'lusin', 'rim', 'kotak'];

  // =============================================
  // UTILITIES
  // =============================================
  function _uid_() {
    if (_uid) return _uid;
    if (typeof currentShop !== 'undefined' && currentShop && currentShop.id) return currentShop.id;
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('warkop_inventory_') === 0) return keys[i].replace('warkop_inventory_', '');
    }
    return null;
  }

  function _genId() {
    if (typeof generateId === 'function') return generateId();
    return 'PB' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function _fmtIDR(n) {
    if (typeof formatIDR === 'function') return formatIDR(n);
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  }

  function _fmtDate(s) {
    if (!s) return '-';
    var d = new Date(s);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function _fmtDT(s) {
    if (!s) return '-';
    var d = new Date(s);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function _today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _thisMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function _now() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
           String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  }

  function _escHtml(s) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(s || ''));
    return div.innerHTML;
  }

  function _getCatLabel(cats, id) {
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === id) return cats[i].label;
    }
    return id || '-';
  }

  function _getCatColor(cats, id) {
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === id) return cats[i].color;
    }
    return 'gray';
  }

  // =============================================
  // DATA LAYER
  // =============================================
  function _loadInv() {
    try {
      var d = localStorage.getItem(LS.inventory(_uid_()));
      _inventory = d ? JSON.parse(d) : [];
    } catch(e) { _inventory = []; }
  }

  function _saveInv() {
    localStorage.setItem(LS.inventory(_uid_()), JSON.stringify(_inventory));
  }

  function _loadProd() {
    try {
      var d = localStorage.getItem(LS.production(_uid_()));
      _production = d ? JSON.parse(d) : [];
    } catch(e) { _production = []; }
  }

  function _saveProd() {
    localStorage.setItem(LS.production(_uid_()), JSON.stringify(_production));
  }

  function _loadExp() {
    try {
      var d = localStorage.getItem(LS.expenses(_uid_()));
      _expenses = d ? JSON.parse(d) : [];
    } catch(e) { _expenses = []; }
  }

  function _saveExp() {
    localStorage.setItem(LS.expenses(_uid_()), JSON.stringify(_expenses));
  }

  function _loadSales(cb) {
    var uid = _uid_();
    if (!uid) { cb([]); return; }
    if (_salesCache) { cb(_salesCache); return; }

    if (typeof idbGetAllTransactions === 'function') {
      idbGetAllTransactions(uid).then(function(data) {
        _salesCache = data || [];
        cb(_salesCache);
      }).catch(function() {
        _loadSalesLS(uid, cb);
      });
    } else {
      _loadSalesLS(uid, cb);
    }
  }

  function _loadSalesLS(uid, cb) {
    try {
      var d = localStorage.getItem('warkop_transactions_' + uid);
      _salesCache = d ? JSON.parse(d) : [];
      cb(_salesCache);
    } catch(e) { cb([]); }
  }

  function _invalidateSalesCache() {
    _salesCache = null;
  }

  // =============================================
  // INVENTORY CRUD
  // =============================================
  function addStockItem(name, stock, unit, category, hargaBeli, lowStock) {
    _loadInv();
    _inventory.push({
      id: _genId(),
      name: name.trim(),
      stock: Number(stock) || 0,
      unit: unit || 'pcs',
      category: category || 'bahan_baku',
      hargaBeli: Number(hargaBeli) || 0,
      lowStock: Number(lowStock) || 5,
      createdAt: _now()
    });
    _saveInv();
    // Auto-create expense for bahan baku cost
    var totalCost = (Number(stock) || 0) * (Number(hargaBeli) || 0);
    if (totalCost > 0) {
      addExpense('Stok masuk: ' + name.trim() + ' (' + (Number(stock) || 0) + ' ' + (unit || 'pcs') + ')', 'bahan_baku', totalCost, _now(), true);
    }
  }

  function editStockItem(id, updates) {
    _loadInv();
    for (var i = 0; i < _inventory.length; i++) {
      if (_inventory[i].id === id) {
        if (updates.name !== undefined) _inventory[i].name = updates.name.trim();
        if (updates.stock !== undefined) _inventory[i].stock = Number(updates.stock);
        if (updates.unit !== undefined) _inventory[i].unit = updates.unit;
        if (updates.category !== undefined) _inventory[i].category = updates.category;
        if (updates.hargaBeli !== undefined) _inventory[i].hargaBeli = Number(updates.hargaBeli);
        if (updates.lowStock !== undefined) _inventory[i].lowStock = Number(updates.lowStock);
        break;
      }
    }
    _saveInv();
  }

  function deleteStockItem(id) {
    _loadInv();
    _inventory = _inventory.filter(function(item) { return item.id !== id; });
    _saveInv();
  }

  function adjustStock(id, amount) {
    _loadInv();
    var result = null;
    for (var i = 0; i < _inventory.length; i++) {
      if (_inventory[i].id === id) {
        var oldStock = _inventory[i].stock || 0;
        _inventory[i].stock = Math.max(0, oldStock + Number(amount));
        result = {
          name: _inventory[i].name,
          unit: _inventory[i].unit,
          delta: _inventory[i].stock - oldStock,
          hargaBeli: _inventory[i].hargaBeli || 0
        };
        break;
      }
    }
    _saveInv();
    return result;
  }

  function getStockItem(id) {
    _loadInv();
    for (var i = 0; i < _inventory.length; i++) {
      if (_inventory[i].id === id) return _inventory[i];
    }
    return null;
  }

  // =============================================
  // PRODUCTION CRUD (many-to-1: multiple bahan baku → 1 produk jadi)
  // =============================================
  // inputs format: [{ fromId, qty }]
  function addProduction(inputs, toId, toQty) {
    _loadInv();
    _loadProd();

    var toItem = null;
    for (var t = 0; t < _inventory.length; t++) {
      if (_inventory[t].id === toId) { toItem = _inventory[t]; break; }
    }
    if (!toItem) return { ok: false, msg: 'Produk jadi tidak ditemukan' };
    if (!inputs || inputs.length === 0) return { ok: false, msg: 'Pilih minimal 1 bahan baku!' };

    // Validate all inputs and check stock
    var inputDetails = [];
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var fromItem = null;
      for (var f = 0; f < _inventory.length; f++) {
        if (_inventory[f].id === inp.fromId) { fromItem = _inventory[f]; break; }
      }
      if (!fromItem) return { ok: false, msg: 'Bahan baku "' + (inp.fromId || '?') + '" tidak ditemukan' };
      var qty = Number(inp.qty) || 0;
      if (qty <= 0) return { ok: false, msg: 'Jumlah ' + fromItem.name + ' harus lebih dari 0' };
      if (fromItem.stock < qty) return { ok: false, msg: 'Stok "' + fromItem.name + '" tidak cukup! Sisa: ' + fromItem.stock + ' ' + fromItem.unit };
      inputDetails.push({ fromId: fromItem.id, fromName: fromItem.name, fromUnit: fromItem.unit, qty: qty });
    }

    // Deduct all inputs, add to output
    for (var d = 0; d < inputDetails.length; d++) {
      for (var inv = 0; inv < _inventory.length; inv++) {
        if (_inventory[inv].id === inputDetails[d].fromId) {
          _inventory[inv].stock -= inputDetails[d].qty;
          break;
        }
      }
    }
    toItem.stock += Number(toQty) || 0;

    // Build summary text
    var bahanSummary = '';
    for (var s = 0; s < inputDetails.length; s++) {
      bahanSummary += (s > 0 ? ' + ' : '') + inputDetails[s].qty + inputDetails[s].fromUnit + ' ' + inputDetails[s].fromName;
    }

    _production.push({
      id: _genId(),
      toId: toId,
      toName: toItem.name,
      toUnit: toItem.unit,
      toQty: Number(toQty) || 0,
      inputs: inputDetails,
      date: _now()
    });

    _saveInv();
    _saveProd();
    return { ok: true, msg: toQty + ' ' + toItem.unit + ' ' + toItem.name + ' ← ' + bahanSummary };
  }

  // Legacy helper: convert old single-input format to new format
  function _normalizeProductionRecord(rec) {
    if (rec.inputs) return rec;
    return {
      id: rec.id,
      toId: rec.toId,
      toName: rec.toName,
      toUnit: rec.unit || 'pcs',
      toQty: rec.qty,
      inputs: [{ fromId: rec.fromId, fromName: rec.fromName, fromUnit: rec.unit || '', qty: rec.qty }],
      date: rec.date
    };
  }

  function deleteProduction(id) {
    _loadProd();
    _production = _production.filter(function(item) { return item.id !== id; });
    _saveProd();
  }

  // =============================================
  // EXPENSE CRUD
  // =============================================
  function addExpense(name, category, amount, date, auto) {
    _loadExp();
    _expenses.push({
      id: _genId(),
      type: 'expense',
      name: name.trim(),
      category: category || 'lainnya',
      amount: Number(amount) || 0,
      date: date || _now(),
      auto: !!auto
    });
    _saveExp();
  }

  function editExpense(id, updates) {
    _loadExp();
    for (var i = 0; i < _expenses.length; i++) {
      if (_expenses[i].id === id) {
        if (updates.name !== undefined) _expenses[i].name = updates.name.trim();
        if (updates.category !== undefined) _expenses[i].category = updates.category;
        if (updates.amount !== undefined) _expenses[i].amount = Number(updates.amount);
        if (updates.date !== undefined) _expenses[i].date = updates.date;
        break;
      }
    }
    _saveExp();
  }

  function deleteExpense(id) {
    _loadExp();
    _expenses = _expenses.filter(function(item) { return item.id !== id; });
    _saveExp();
  }

  // =============================================
  // REPORT
  // =============================================
  function calcReport(periodType, dateVal) {
    return new Promise(function(resolve) {
      _loadSales(function(sales) {
        _loadExp();
        _loadInv();

        var len = periodType === 'daily' ? 10 : 7;
        var totalSales = 0, totalExpBB = 0, totalExpOps = 0, trxCount = 0, expCount = 0;
        var filteredSales = [], filteredExp = [];

        for (var i = 0; i < sales.length; i++) {
          var sd = (sales[i].date || '').substring(0, len);
          if (sd === dateVal) {
            totalSales += Number(sales[i].total) || 0;
            trxCount++;
            filteredSales.push(sales[i]);
          }
        }

        for (var j = 0; j < _expenses.length; j++) {
          var ed = (_expenses[j].date || '').substring(0, len);
          if (ed === dateVal) {
            var amt = Number(_expenses[j].amount) || 0;
            expCount++;
            filteredExp.push(_expenses[j]);
            // Separate Bahan Baku vs Operasional
            if ((_expenses[j].category || '') === 'bahan_baku') {
              totalExpBB += amt;
            } else {
              totalExpOps += amt;
            }
          }
        }

        var totalExp = totalExpBB + totalExpOps;

        // Group expenses by category
        var expByCat = {};
        for (var k = 0; k < filteredExp.length; k++) {
          var cat = filteredExp[k].category || 'lainnya';
          if (!expByCat[cat]) expByCat[cat] = 0;
          expByCat[cat] += Number(filteredExp[k].amount) || 0;
        }

        // Calculate total inventory value (stock * hargaBeli)
        var totalInventoryValue = 0;
        for (var m = 0; m < _inventory.length; m++) {
          totalInventoryValue += (_inventory[m].stock || 0) * (_inventory[m].hargaBeli || 0);
        }

        resolve({
          period: dateVal,
          periodType: periodType,
          totalSales: totalSales,
          totalExpenses: totalExp,
          totalExpBB: totalExpBB,
          totalExpOps: totalExpOps,
          totalInventoryValue: totalInventoryValue,
          profit: totalSales - totalExp,
          trxCount: trxCount,
          expCount: expCount,
          sales: filteredSales,
          expenses: filteredExp,
          expByCat: expByCat
        });
      });
    });
  }

  // =============================================
  // CSS INJECTION
  // =============================================
  function _injectCSS() {
    if (document.getElementById('pb-styles')) return;
    var css = document.createElement('style');
    css.id = 'pb-styles';
    css.textContent = '\
#mode-select-overlay{position:fixed;inset:0;z-index:9999;background:linear-gradient(135deg,#064E3B 0%,#065F46 30%,#047857 60%,#059669 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}\
#mode-select-overlay.hidden{display:none}\
.mode-card{background:white;border-radius:24px;padding:32px 24px;text-align:center;max-width:380px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,0.3);animation:pbFadeUp .4s ease}\
@keyframes pbFadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}\
.mode-btn{display:flex;align-items:center;gap:14px;width:100%;padding:18px 20px;border-radius:16px;border:2px solid #E5E7EB;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;background:white}\
.mode-btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,0.1)}\
.mode-btn-pos{color:#0369A1;border-color:#BAE6FD}\
.mode-btn-pos:hover{background:#F0F9FF;border-color:#0EA5E9}\
.mode-btn-pb{color:#065F46;border-color:#A7F3D0}\
.mode-btn-pb:hover{background:#ECFDF5;border-color:#10B981}\
.mode-btn .mode-icon{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px}\
.mode-btn-pos .mode-icon{background:linear-gradient(135deg,#0EA5E9,#0369A1);color:white}\
.mode-btn-pb .mode-icon{background:linear-gradient(135deg,#10B981,#065F46);color:white}\
#pembukuan-view{display:flex!important;flex-direction:column;height:100vh;height:100dvh;height:calc(var(--vh,1vh)*100);overflow:hidden;background:#F8FAFC}\
#pembukuan-view.hidden{display:none!important}\
.pb-header{background:linear-gradient(135deg,#065F46,#047857);color:white;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0!important;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,0.1)}\
.pb-subnav{background:white;border-bottom:1px solid #E5E7EB;overflow-x:auto;flex-shrink:0!important;z-index:40}\
.pb-subnav-inner{display:flex;max-width:700px;margin:0 auto}\
.pb-nav-btn{flex:1;padding:10px 4px;border:none;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all .15s;border-bottom:3px solid transparent;min-width:64px}\
.pb-nav-btn.nav-active{color:#059669;border-bottom-color:#059669;background:#ECFDF5}\
.pb-nav-btn.nav-inactive{color:#94A3B8}\
.pb-nav-btn i{font-size:16px}\
.pb-nav-btn span{font-size:10px;font-weight:600}\
.pb-content{max-width:700px;margin:0 auto;padding:16px;padding-bottom:40px;flex:1 1 0%!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}\
.pb-card{background:white;border-radius:16px;border:1px solid #E5E7EB;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04);overflow-x:auto;-webkit-overflow-scrolling:touch}\
.pb-card-title{font-size:14px;font-weight:700;color:#1E293B;margin-bottom:12px;display:flex;align-items:center;gap:8px}\
.pb-stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}\
.pb-stat{background:white;border-radius:14px;border:1px solid #E5E7EB;padding:14px;text-align:center}\
.pb-stat-label{font-size:11px;color:#64748B;font-weight:600;margin-bottom:4px}\
.pb-stat-val{font-size:18px;font-weight:800}\
.pb-stat-val.green{color:#059669}\
.pb-stat-val.red{color:#DC2626}\
.pb-stat-val.blue{color:#0284C7}\
.pb-stat-val.emerald{color:#047857}\
.pb-btn{padding:8px 16px;border-radius:10px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:6px}\
.pb-btn-primary{background:linear-gradient(135deg,#059669,#047857);color:white;box-shadow:0 2px 6px rgba(4,120,87,0.3)}\
.pb-btn-primary:hover{box-shadow:0 4px 12px rgba(4,120,87,0.4);transform:translateY(-1px)}\
.pb-btn-danger{background:#FEE2E2;color:#DC2626}\
.pb-btn-danger:hover{background:#FECACA}\
.pb-btn-ghost{background:#F1F5F9;color:#475569}\
.pb-btn-ghost:hover{background:#E2E8F0}\
.pb-btn-sm{padding:5px 10px;font-size:11px;border-radius:8px}\
.pb-input{width:100%;padding:10px 12px;border:1.5px solid #D1D5DB;border-radius:10px;font-size:13px;outline:none;transition:border-color .15s;background:white;font-family:inherit}\
.pb-input:focus{border-color:#10B981;box-shadow:0 0 0 3px rgba(16,185,129,0.1)}\
.pb-select{padding:10px 12px;border:1.5px solid #D1D5DB;border-radius:10px;font-size:13px;outline:none;background:white;cursor:pointer;font-family:inherit}\
.pb-select:focus{border-color:#10B981}\
.pb-label{font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;display:block}\
.pb-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;min-width:480px}\
.pb-table th{text-align:left;padding:8px 8px;color:#64748B;font-weight:600;border-bottom:2px solid #E5E7EB;font-size:11px;text-transform:uppercase;letter-spacing:.5px;word-wrap:break-word;overflow-wrap:break-word;white-space:normal}\
.pb-table td{padding:8px;border-bottom:1px solid #F1F5F9;vertical-align:middle;word-wrap:break-word;overflow-wrap:break-word;white-space:normal}\
.pb-table tr:hover td{background:#F8FAFC}\
.pb-expense-list,.pb-auto-list,.pb-stock-list,.pb-prod-list{display:flex;flex-direction:column;gap:10px}\
.pb-expense-card{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:1px solid #F1F5F9}\
.pb-expense-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}\
.pb-expense-card-info{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}\
.pb-expense-card-name{font-size:15px;font-weight:700;color:#1E293B;word-wrap:break-word;overflow-wrap:break-word}\
.pb-expense-card-amount{font-size:16px;font-weight:800;color:#DC2626;white-space:nowrap;flex-shrink:0}\
.pb-expense-card-bottom{display:flex;justify-content:space-between;align-items:center;gap:8px}\
.pb-expense-card-date{font-size:11px;color:#94A3B8;white-space:nowrap}\
.pb-expense-card-date i{margin-right:3px;font-size:10px}\
.pb-expense-card-actions{display:flex;gap:6px;flex-shrink:0}\
.pb-auto-card{background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:8px;border:1px solid #FDE68A;box-shadow:0 1px 4px rgba(0,0,0,0.04)}\
.pb-auto-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px}\
.pb-auto-card-info{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}\
.pb-auto-card-name{font-size:14px;font-weight:600;color:#1E293B;word-wrap:break-word;overflow-wrap:break-word}\
.pb-auto-card-amount{font-size:14px;font-weight:700;color:#B45309;white-space:nowrap;flex-shrink:0}\
.pb-auto-card-date{font-size:11px;color:#94A3B8}\
.pb-auto-card-date i{margin-right:3px;font-size:10px}\
.pb-stock-card{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:1px solid #F1F5F9}\
.pb-stock-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px}\
.pb-stock-card-info{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}\
.pb-stock-card-name{font-size:15px;font-weight:700;color:#1E293B;word-wrap:break-word;overflow-wrap:break-word}\
.pb-stock-card-qty{font-size:18px;font-weight:800;white-space:nowrap;flex-shrink:0}\
.pb-stock-card-mid{display:flex;gap:16px;margin-bottom:8px;flex-wrap:wrap}\
.pb-stock-card-price{font-size:12px;color:#64748B}\
.pb-stock-card-value{font-size:12px;font-weight:600;color:#1E293B}\
.pb-stock-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}\
.pb-prod-card{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:1px solid #F1F5F9}\
.pb-prod-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px}\
.pb-prod-card-info{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}\
.pb-prod-card-name{font-size:14px;font-weight:700;color:#059669;word-wrap:break-word;overflow-wrap:break-word}\
.pb-prod-card-bahan{font-size:12px;color:#475569;line-height:1.4;word-wrap:break-word;overflow-wrap:break-word}\
.pb-prod-card-date{font-size:11px;color:#94A3B8}\
.pb-prod-card-date i{margin-right:3px;font-size:10px}\
.pb-badge{display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600}\
.pb-empty{text-align:center;padding:40px 20px;color:#94A3B8}\
.pb-empty i{font-size:36px;margin-bottom:8px;display:block}\
.pb-empty p{font-size:13px}\
.pb-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;animation:pbFade .15s ease}\
@keyframes pbFade{from{opacity:0}to{opacity:1}}\
.pb-modal{background:white;border-radius:20px;width:100%;max-width:420px;max-height:85vh;overflow-y:auto;box-shadow:0 25px 50px rgba(0,0,0,0.15);animation:pbSlideUp .2s ease}\
@keyframes pbSlideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}\
.pb-modal-header{padding:16px 20px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between}\
.pb-modal-header h3{font-size:15px;font-weight:700;color:#1E293B}\
.pb-modal-body{padding:20px}\
.pb-modal-footer{padding:12px 20px;border-top:1px solid #E5E7EB;display:flex;gap:8px;justify-content:flex-end}\
.pb-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:600}\
.pb-chip-amber{background:#FFFBEB;color:#B45309}\
.pb-chip-blue{background:#EFF6FF;color:#1D4ED8}\
.pb-chip-slate{background:#F1F5F9;color:#475569}\
.pb-chip-green{background:#ECFDF5;color:#047857}\
.pb-divider{border:none;border-top:1px solid #F1F5F9;margin:8px 0}\
.pb-search{position:relative}\
.pb-search i{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94A3B8;font-size:13px}\
.pb-search input{padding-left:36px}\
.pb-guide-hero{background:linear-gradient(135deg,#065F46,#047857,#059669);border-radius:16px;padding:24px 20px;color:white;margin-bottom:16px;text-align:center}\
.pb-guide-hero h2{font-size:20px;font-weight:800;margin-bottom:6px}\
.pb-guide-hero p{font-size:12px;opacity:.85;line-height:1.5}\
.pb-guide-section{background:white;border-radius:16px;border:1px solid #E5E7EB;padding:0;margin-bottom:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)}\
.pb-guide-sec-header{padding:14px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:background .15s;user-select:none}\
.pb-guide-sec-header:hover{background:#F8FAFC}\
.pb-guide-sec-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}\
.pb-guide-sec-title{flex:1;font-size:14px;font-weight:700;color:#1E293B}\
.pb-guide-sec-arrow{color:#94A3B8;font-size:12px;transition:transform .2s}\
.pb-guide-sec-arrow.open{transform:rotate(180deg)}\
.pb-guide-sec-body{padding:0 16px 16px;display:none}\
.pb-guide-sec-body.open{display:block}\
.pb-guide-step{display:flex;gap:10px;margin-bottom:14px}\
.pb-guide-step:last-child{margin-bottom:0}\
.pb-guide-step-num{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:2px}\
.pb-guide-step-text{flex:1;font-size:12px;color:#374151;line-height:1.6}\
.pb-guide-step-text strong{color:#1E293B}\
.pb-guide-tip{background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px;margin-top:12px;font-size:11px;color:#92400E;line-height:1.6;display:flex;gap:8px}\
.pb-guide-tip i{color:#F59E0B;margin-top:2px;flex-shrink:0}\
.pb-guide-example{background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:12px 14px;margin-top:10px;font-size:11px;color:#065F46;line-height:1.6}\
.pb-guide-example strong{color:#047857}\
.pb-guide-flow{display:flex;flex-direction:column;align-items:center;gap:0;margin:12px 0}\
.pb-guide-flow-item{background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:8px 14px;font-size:11px;font-weight:600;color:#334155;text-align:center;width:100%}\
.pb-guide-flow-arrow{color:#94A3B8;font-size:14px;line-height:1}\
';
    document.head.appendChild(css);
  }

  // =============================================
  // HTML INJECTION - MODE SELECTION OVERLAY
  // =============================================
  function _injectModeSelect() {
    if (document.getElementById('mode-select-overlay')) return;
    var el = document.createElement('div');
    el.id = 'mode-select-overlay';
    el.className = 'hidden';
    el.innerHTML = '\
      <div style="margin-bottom:24px;text-align:center;color:white">\
        <div style="font-size:28px;font-weight:900;letter-spacing:-1px;margin-bottom:4px">WARKOPOS</div>\
        <div style="font-size:13px;opacity:.8">Pilih mode untuk melanjutkan</div>\
      </div>\
      <div class="mode-card">\
        <button class="mode-btn mode-btn-pos" style="margin-bottom:12px" onclick="selectMode(\'pos\')">\
          <div class="mode-icon"><i class="fas fa-calculator"></i></div>\
          <div style="text-align:left">\
            <div>Masuk POS</div>\
            <div style="font-size:11px;font-weight:400;color:#64748B;margin-top:2px">Kasir, Pesanan, Struk</div>\
          </div>\
        </button>\
        <button class="mode-btn mode-btn-pb" onclick="selectMode(\'pembukuan\')">\
          <div class="mode-icon"><i class="fas fa-book-open"></i></div>\
          <div style="text-align:left">\
            <div>Masuk Pembukuan</div>\
            <div style="font-size:11px;font-weight:400;color:#64748B;margin-top:2px">Stok, Produksi, Laporan</div>\
          </div>\
        </button>\
      </div>\
      <div style="margin-top:16px;color:rgba(255,255,255,.5);font-size:11px">v2.0 &mdash; Modular POS System</div>';
    document.body.appendChild(el);
  }

  // =============================================
  // HTML INJECTION - PEMBUKUAN VIEW
  // =============================================
  function _injectView() {
    if (document.getElementById('pembukuan-view')) return;
    var el = document.createElement('div');
    el.id = 'pembukuan-view';
    el.className = 'hidden';
    el.innerHTML = '\
      <header class="pb-header">\
        <div style="display:flex;align-items:center;gap:10px">\
          <button onclick="selectMode(\'pos\')" style="background:rgba(255,255,255,.15);border:none;color:white;width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:14px"><i class="fas fa-arrow-left"></i></button>\
          <div>\
            <div style="font-size:15px;font-weight:800;letter-spacing:-.3px">PEMBUKUAN</div>\
            <div style="font-size:10px;opacity:.7">WARKOPOS</div>\
          </div>\
        </div>\
        <div style="display:flex;align-items:center;gap:8px">\
          <button onclick="selectMode(\'pos\')" style="background:rgba(255,255,255,.15);border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:600"><i class="fas fa-calculator mr-1"></i>POS</button>\
        </div>\
      </header>\
      <nav class="pb-subnav">\
        <div class="pb-subnav-inner">\
          <button onclick="Pembukuan.switchPage(\'stok\')" id="pb-nav-stok" class="pb-nav-btn nav-active">\
            <i class="fas fa-boxes-stacked"></i><span>Stok</span>\
          </button>\
          <button onclick="Pembukuan.switchPage(\'produksi\')" id="pb-nav-produksi" class="pb-nav-btn nav-inactive">\
            <i class="fas fa-industry"></i><span>Produksi</span>\
          </button>\
          <button onclick="Pembukuan.switchPage(\'pengeluaran\')" id="pb-nav-pengeluaran" class="pb-nav-btn nav-inactive">\
            <i class="fas fa-receipt"></i><span>Pengeluaran</span>\
          </button>\
          <button onclick="Pembukuan.switchPage(\'penjualan\')" id="pb-nav-penjualan" class="pb-nav-btn nav-inactive">\
            <i class="fas fa-chart-line"></i><span>Penjualan</span>\
          </button>\
          <button onclick="Pembukuan.switchPage(\'laporan\')" id="pb-nav-laporan" class="pb-nav-btn nav-inactive">\
            <i class="fas fa-file-invoice-dollar"></i><span>Laporan</span>\
          </button>\
          <button onclick="Pembukuan.switchPage(\'panduan\')" id="pb-nav-panduan" class="pb-nav-btn nav-inactive">\
            <i class="fas fa-circle-question"></i><span>Panduan</span>\
          </button>\
        </div>\
      </nav>\
      <div class="pb-content" id="pb-content"></div>';
    document.body.appendChild(el);
  }

  // =============================================
  // INJECT PEMBUKUAN NAV BUTTON INTO POS
  // =============================================
  function _injectPOSSwitchBtn() {
    // Inject tombol Pembukuan di bottom navigation bar POS
    if (document.getElementById('nav-pembukuan')) return;
    var navContainer = document.querySelector('#pos-app nav > div');
    if (!navContainer) return;

    var btn = document.createElement('button');
    btn.id = 'nav-pembukuan';
    btn.className = 'nav-btn flex-1 py-3 flex flex-col items-center gap-0.5 text-emerald-600';
    btn.setAttribute('onclick', "selectMode('pembukuan')");
    btn.title = 'Buka Pembukuan';
    btn.innerHTML = '<i class="fas fa-book-open text-lg"></i><span class="text-xs font-medium">Buku</span>';
    navContainer.appendChild(btn);
  }

  // Highlight nav button when returning to POS
  function _highlightPOSNav() {
    var pbNav = document.getElementById('nav-pembukuan');
    if (!pbNav) return;
    pbNav.classList.remove('text-emerald-600', 'bg-emerald-50', 'border-t-2', 'border-emerald-600');
    pbNav.classList.add('text-emerald-600');
    pbNav.style.opacity = '1';
  }

  // =============================================
  // VIEW SWITCHING (GLOBAL)
  // =============================================
  function _showView(viewId) {
    var posApp = document.getElementById('pos-app');
    var pbView = document.getElementById('pembukuan-view');
    var overlay = document.getElementById('mode-select-overlay');

    if (overlay) {
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
    }

    if (viewId === 'pos') {
      // Show POS the same way showPOS() does
      if (pbView) {
        pbView.classList.add('hidden');
        pbView.style.display = 'none';
      }
      if (posApp) {
        posApp.classList.remove('hidden');
        posApp.classList.add('pos-visible');
        posApp.style.display = '';  // clear inline display:none
      }
      localStorage.setItem(LS.appMode, 'pos');
      // Re-inject nav button every time we return to POS (in case DOM was modified)
      setTimeout(function() { _injectPOSSwitchBtn(); _highlightPOSNav(); }, 100);
    } else if (viewId === 'pembukuan') {
      // Hide POS the same way showScreen() does
      if (posApp) {
        posApp.classList.remove('pos-visible');
        posApp.classList.add('hidden');
        posApp.style.display = 'none';  // must use inline style to override showPOS()
      }
      if (pbView) {
        pbView.classList.remove('hidden');
        pbView.style.display = '';  // let CSS display:flex take effect (NOT 'block'!)
      }
      localStorage.setItem(LS.appMode, 'pembukuan');
      if (!_initialized) {
        _init();
      } else {
        _renderPage(_currentPage);
      }
    }
  }

  function _showModeSelect() {
    var saved = localStorage.getItem(LS.appMode);
    var overlay = document.getElementById('mode-select-overlay');

    if (saved === 'pos') {
      _showView('pos');
      return;
    }
    if (saved === 'pembukuan') {
      _showView('pembukuan');
      return;
    }
    // No saved preference, show selection overlay
    if (overlay) {
      // Hide POS first (using inline style like showScreen does)
      var posApp = document.getElementById('pos-app');
      if (posApp) {
        posApp.classList.remove('pos-visible');
        posApp.style.display = 'none';
      }
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
    } else {
      _showView('pos');
    }
  }

  // Expose to global
  window.showView = function(viewId) { _showView(viewId); };
  window.selectMode = function(mode) { _showView(mode); };
  window.showModeSelect = function() { _showModeSelect(); };

  // =============================================
  // NAVIGATION
  // =============================================
  function _switchPage(page) {
    _currentPage = page;
    var pages = ['stok', 'produksi', 'pengeluaran', 'penjualan', 'laporan', 'panduan'];
    for (var i = 0; i < pages.length; i++) {
      var nav = document.getElementById('pb-nav-' + pages[i]);
      if (nav) {
        nav.classList.remove('nav-active');
        nav.classList.add('nav-inactive');
      }
    }
    var activeNav = document.getElementById('pb-nav-' + page);
    if (activeNav) {
      activeNav.classList.remove('nav-inactive');
      activeNav.classList.add('nav-active');
    }
    _renderPage(page);
  }

  function _renderPage(page) {
    var container = document.getElementById('pb-content');
    if (!container) return;
    switch(page) {
      case 'stok': _renderStok(container); break;
      case 'produksi': _renderProduksi(container); break;
      case 'pengeluaran': _renderPengeluaran(container); break;
      case 'penjualan': _renderPenjualan(container); break;
      case 'laporan': _renderLaporan(container); break;
      case 'panduan': _renderPanduan(container); break;
      default: _renderStok(container);
    }
  }

  // =============================================
  // RENDER: STOK
  // =============================================
  function _renderStok(container) {
    _loadInv();
    var totalItems = _inventory.length;
    var lowStock = 0;
    var totalValue = 0;
    for (var i = 0; i < _inventory.length; i++) {
      var threshold = _inventory[i].lowStock || 5;
      if (_inventory[i].stock <= threshold) lowStock++;
      totalValue += (_inventory[i].stock || 0) * (_inventory[i].hargaBeli || 0);
    }

    var catFilter = '\
      <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">\
        <button onclick="Pembukuan._renderStokFiltered(\'all\')" class="pb-btn pb-btn-primary pb-btn-sm" id="pb-stock-cat-all">Semua (' + totalItems + ')</button>';
    for (var c = 0; c < STOCK_CATS.length; c++) {
      var catCount = 0;
      for (var j = 0; j < _inventory.length; j++) {
        if (_inventory[j].category === STOCK_CATS[c].id) catCount++;
      }
      catFilter += '<button onclick="Pembukuan._renderStokFiltered(\'' + STOCK_CATS[c].id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm" id="pb-stock-cat-' + STOCK_CATS[c].id + '">' + STOCK_CATS[c].label + ' (' + catCount + ')</button>';
    }
    catFilter += '<button onclick="Pembukuan._renderStokFiltered(\'low_stock\')" class="pb-btn pb-btn-ghost pb-btn-sm" id="pb-stock-cat-low_stock">Stok Rendah (' + lowStock + ')</button>';
    catFilter += '</div>';

    container.innerHTML = '\
      <div class="pb-stat-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">\
        <div class="pb-stat"><div class="pb-stat-label">Total Item</div><div class="pb-stat-val blue">' + totalItems + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Stok Rendah</div><div class="pb-stat-val red">' + lowStock + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Nilai Stok</div><div class="pb-stat-val emerald">' + _fmtIDR(totalValue) + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Kategori</div><div class="pb-stat-val">' + STOCK_CATS.length + '</div></div>\
      </div>\
      <div class="pb-card">\
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">\
          <div class="pb-card-title" style="margin-bottom:0"><i class="fas fa-boxes-stacked" style="color:#059669"></i> Daftar Stok</div>\
          <button onclick="Pembukuan._showAddStockModal()" class="pb-btn pb-btn-primary pb-btn-sm"><i class="fas fa-plus"></i> Tambah</button>\
        </div>\
        <div class="pb-search" style="margin-bottom:12px">\
          <i class="fas fa-magnifying-glass"></i>\
          <input type="text" class="pb-input" placeholder="Cari stok..." oninput="Pembukuan._filterStokSearch(this.value)">\
        </div>' +
        catFilter +
        '<div id="pb-stock-list"></div>\
      </div>';

    _renderStockList(_inventory);
  }

  function _renderStockList(items) {
    var list = document.getElementById('pb-stock-list');
    if (!list) return;

    if (items.length === 0) {
      list.innerHTML = '<div class="pb-empty"><i class="fas fa-box-open"></i><p>Belum ada data stok</p></div>';
      return;
    }

    var html = '<div class="pb-stock-list">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var threshold = item.lowStock || 5;
      var isLow = item.stock <= threshold;
      var stockColor = isLow ? 'color:#DC2626' : 'color:#059669';
      var catLabel = _getCatLabel(STOCK_CATS, item.category);
      var nilai = (item.stock || 0) * (item.hargaBeli || 0);
      html += '<div class="pb-stock-card" id="pb-stock-row-' + item.id + '">\
        <div class="pb-stock-card-top">\
          <div class="pb-stock-card-info">\
            <div class="pb-stock-card-name">' + _escHtml(item.name) + '</div>\
            <span class="pb-chip pb-chip-green">' + _escHtml(catLabel) + '</span>\
          </div>\
          <div class="pb-stock-card-qty" style="' + stockColor + '">' + item.stock + ' ' + _escHtml(item.unit) + '</div>\
        </div>\
        <div class="pb-stock-card-mid">\
          <div class="pb-stock-card-price">' + (item.hargaBeli ? _fmtIDR(item.hargaBeli) + '/' + _escHtml(item.unit) : 'Rp -') + '</div>\
          <div class="pb-stock-card-value">Nilai: ' + _fmtIDR(nilai) + '</div>\
        </div>' +
        (isLow ? '<div style="font-size:11px;color:#DC2626;padding:2px 0"><i class="fas fa-triangle-exclamation"></i> Stok rendah! Min: ' + threshold + ' ' + _escHtml(item.unit) + '</div>' : '') +
        '<div class="pb-stock-card-actions">\
          <button onclick="Pembukuan._showEditStockModal(\'' + item.id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm" title="Edit"><i class="fas fa-pen"></i> Edit</button>\
          <button onclick="Pembukuan._adjustStockModal(\'' + item.id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm" title="Sesuaikan Stok"><i class="fas fa-plus-minus"></i> Stok</button>\
          <button onclick="Pembukuan._deleteStock(\'' + item.id + '\')" class="pb-btn pb-btn-danger pb-btn-sm" title="Hapus"><i class="fas fa-trash"></i></button>\
        </div>\
      </div>';
    }
    html += '</div>';
    list.innerHTML = html;
  }

  function _renderStokFiltered(category) {
    _loadInv();
    var filtered;
    if (category === 'low_stock') {
      filtered = _inventory.filter(function(item) {
        var threshold = item.lowStock || 5;
        return item.stock <= threshold;
      });
    } else if (category === 'all') {
      filtered = _inventory;
    } else {
      filtered = _inventory.filter(function(item) { return item.category === category; });
    }

    // Update button styles
    var buttons = document.querySelectorAll('#pb-content .pb-card .pb-btn');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].id === 'pb-stock-cat-' + category) {
        buttons[i].className = 'pb-btn pb-btn-primary pb-btn-sm';
      } else if (buttons[i].id && buttons[i].id.indexOf('pb-stock-cat-') === 0) {
        buttons[i].className = 'pb-btn pb-btn-ghost pb-btn-sm';
      }
    }

    _renderStockList(filtered);
  }

  function _filterStokSearch(query) {
    _loadInv();
    var q = (query || '').toLowerCase();
    var filtered = _inventory.filter(function(item) {
      return item.name.toLowerCase().indexOf(q) !== -1;
    });
    _renderStockList(filtered);
  }

  // =============================================
  // MODAL: ADD / EDIT STOK
  // =============================================
  function _showAddStockModal() {
    _showStockModal(null);
  }

  function _showEditStockModal(id) {
    var item = getStockItem(id);
    if (!item) return;
    _showStockModal(item);
  }

  function _showStockModal(item) {
    var isEdit = !!item;
    var title = isEdit ? 'Edit Stok' : 'Tambah Stok Baru';

    var catOptions = '';
    for (var i = 0; i < STOCK_CATS.length; i++) {
      var sel = isEdit && item.category === STOCK_CATS[i].id ? 'selected' : (!isEdit && STOCK_CATS[i].id === 'bahan_baku' ? 'selected' : '');
      catOptions += '<option value="' + STOCK_CATS[i].id + '" ' + sel + '>' + STOCK_CATS[i].label + '</option>';
    }

    var unitOptions = '';
    for (var u = 0; u < UNITS.length; u++) {
      var usel = isEdit && item.unit === UNITS[u] ? 'selected' : '';
      unitOptions += '<option value="' + UNITS[u] + '" ' + usel + '>' + UNITS[u] + '</option>';
    }

    var modal = document.createElement('div');
    modal.className = 'pb-modal-bg';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '\
      <div class="pb-modal">\
        <div class="pb-modal-header">\
          <h3><i class="fas fa-box mr-2" style="color:#059669"></i>' + title + '</h3>\
          <button onclick="this.closest(\'.pb-modal-bg\').remove()" style="background:none;border:none;cursor:pointer;color:#94A3B8;font-size:16px"><i class="fas fa-xmark"></i></button>\
        </div>\
        <div class="pb-modal-body">\
          <div style="margin-bottom:12px">\
            <label class="pb-label">Nama Item</label>\
            <input type="text" id="pb-stock-name" class="pb-input" placeholder="Contoh: Ayam Mentah" value="' + (isEdit ? _escHtml(item.name) : '') + '">\
          </div>\
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">\
            <div>\
              <label class="pb-label">Stok</label>\
              <input type="number" id="pb-stock-qty" class="pb-input" placeholder="0" min="0" value="' + (isEdit ? item.stock : 0) + '">\
            </div>\
            <div>\
              <label class="pb-label">Satuan</label>\
              <select id="pb-stock-unit" class="pb-select" style="width:100%">' + unitOptions + '</select>\
            </div>\
          </div>\
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">\
            <div>\
              <label class="pb-label">Harga Beli / ' + (isEdit ? _escHtml(item.unit) : 'unit') + '</label>\
              <input type="number" id="pb-stock-price" class="pb-input" placeholder="0" min="0" value="' + (isEdit && item.hargaBeli ? item.hargaBeli : '') + '" oninput="Pembukuan._updateStockValuePreview()">\
              <div style="font-size:10px;color:#94A3B8;margin-top:2px">Harga modal per satuan</div>\
            </div>\
            <div>\
              <label class="pb-label">Batas Stok Rendah</label>\
              <input type="number" id="pb-stock-low" class="pb-input" placeholder="5" min="0" value="' + (isEdit && item.lowStock ? item.lowStock : 5) + '" oninput="Pembukuan._updateStockValuePreview()">\
              <div style="font-size:10px;color:#94A3B8;margin-top:2px">Peringatan jika stok di bawah ini</div>\
            </div>\
          </div>\
          <div id="pb-stock-preview" style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:10px;text-align:center;display:none">\
            <div style="font-size:11px;color:#64748B">Total Nilai Stok</div>\
            <div style="font-size:16px;font-weight:800;color:#047857" id="pb-stock-preview-val">Rp 0</div>\
          </div>\
          <div id="pb-stock-auto-exp-note" style="font-size:10px;color:#B45309;display:none;margin-top:4px;text-align:center"><i class="fas fa-link"></i> Otomatis tercatat sebagai Pengeluaran Bahan Baku</div>\
          <div>\
            <label class="pb-label">Kategori</label>\
            <select id="pb-stock-cat" class="pb-select" style="width:100%">' + catOptions + '</select>\
          </div>\
        </div>\
        <div class="pb-modal-footer">\
          <button onclick="this.closest(\'.pb-modal-bg\').remove()" class="pb-btn pb-btn-ghost">Batal</button>\
          <button onclick="Pembukuan._saveStock(\'' + (isEdit ? item.id : '') + '\')" class="pb-btn pb-btn-primary"><i class="fas fa-check"></i> Simpan</button>\
        </div>\
      </div>';
    document.body.appendChild(modal);
    document.getElementById('pb-stock-name').focus();
  }

  function _saveStock(editId) {
    var name = document.getElementById('pb-stock-name').value.trim();
    var qty = document.getElementById('pb-stock-qty').value;
    var unit = document.getElementById('pb-stock-unit').value;
    var cat = document.getElementById('pb-stock-cat').value;
    var hargaBeli = document.getElementById('pb-stock-price').value;
    var lowStockVal = document.getElementById('pb-stock-low').value;

    if (!name) { alert('Nama item wajib diisi!'); return; }
    if (!qty || Number(qty) < 0) { alert('Stok harus berupa angka positif!'); return; }

    if (editId) {
      editStockItem(editId, { name: name, stock: Number(qty), unit: unit, category: cat, hargaBeli: Number(hargaBeli) || 0, lowStock: Number(lowStockVal) || 5 });
    } else {
      addStockItem(name, Number(qty), unit, cat, Number(hargaBeli) || 0, Number(lowStockVal) || 5);
    }

    document.querySelector('.pb-modal-bg').remove();
    _renderStok(document.getElementById('pb-content'));
  }

  function _updateStockValuePreview() {
    var qty = Number(document.getElementById('pb-stock-qty').value) || 0;
    var price = Number(document.getElementById('pb-stock-price').value) || 0;
    var previewEl = document.getElementById('pb-stock-preview');
    var previewVal = document.getElementById('pb-stock-preview-val');
    var autoNote = document.getElementById('pb-stock-auto-exp-note');
    if (!previewEl || !previewVal) return;
    var total = qty * price;
    if (total > 0) {
      previewEl.style.display = 'block';
      previewVal.textContent = _fmtIDR(total);
      if (autoNote) autoNote.style.display = 'block';
    } else {
      previewEl.style.display = 'none';
      if (autoNote) autoNote.style.display = 'none';
    }
  }

  function _adjustStockModal(id) {
    var item = getStockItem(id);
    if (!item) return;

    var modal = document.createElement('div');
    modal.className = 'pb-modal-bg';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '\
      <div class="pb-modal">\
        <div class="pb-modal-header">\
          <h3><i class="fas fa-plus-minus mr-2" style="color:#059669"></i>Sesuaikan Stok</h3>\
          <button onclick="this.closest(\'.pb-modal-bg\').remove()" style="background:none;border:none;cursor:pointer;color:#94A3B8;font-size:16px"><i class="fas fa-xmark"></i></button>\
        </div>\
        <div class="pb-modal-body">\
          <div style="text-align:center;margin-bottom:16px">\
            <div style="font-size:13px;color:#64748B">Item</div>\
            <div style="font-size:18px;font-weight:700;color:#1E293B">' + _escHtml(item.name) + '</div>\
            <div style="font-size:13px;color:#64748B">Stok saat ini: <b style="color:#059669">' + item.stock + ' ' + _escHtml(item.unit) + '</b></div>\
          </div>\
          <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:12px">\
            <button onclick="Pembukuan._adjStockDelta(-1)" class="pb-btn pb-btn-danger pb-btn-sm" style="font-size:16px;padding:8px 14px"><i class="fas fa-minus"></i></button>\
            <input type="number" id="pb-adj-amount" class="pb-input" style="width:100px;text-align:center;font-size:18px;font-weight:700" value="1" min="1">\
            <button onclick="Pembukuan._adjStockDelta(1)" class="pb-btn pb-btn-primary pb-btn-sm" style="font-size:16px;padding:8px 14px"><i class="fas fa-plus"></i></button>\
          </div>\
          <div style="display:flex;gap:6px;justify-content:center">\
            <button onclick="document.getElementById(\'pb-adj-amount\').value=5" class="pb-btn pb-btn-ghost pb-btn-sm">5</button>\
            <button onclick="document.getElementById(\'pb-adj-amount\').value=10" class="pb-btn pb-btn-ghost pb-btn-sm">10</button>\
            <button onclick="document.getElementById(\'pb-adj-amount\').value=25" class="pb-btn pb-btn-ghost pb-btn-sm">25</button>\
            <button onclick="document.getElementById(\'pb-adj-amount\').value=50" class="pb-btn pb-btn-ghost pb-btn-sm">50</button>\
          </div>' + (item.hargaBeli ? '\
          <div style="margin-top:14px;padding:10px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;display:flex;align-items:flex-start;gap:8px">\
            <input type="checkbox" id="pb-adj-auto-exp" checked style="width:18px;height:18px;accent-color:#059669;margin-top:2px">\
            <label for="pb-adj-auto-exp" style="font-size:12px;color:#92400E">\
              <b>Catat ke Pengeluaran Bahan Baku</b><br>\
              <span style="font-size:10px;color:#B45309">Harga beli: ' + _fmtIDR(item.hargaBeli) + '/' + _escHtml(item.unit) + '</span>\
            </label>\
          </div>' : '') + '\
        </div>\
        <div class="pb-modal-footer">\
          <button onclick="Pembukuan._doAdjustStock(\'' + id + '\',-1)" class="pb-btn pb-btn-danger"><i class="fas fa-minus"></i> Kurangi</button>\
          <button onclick="Pembukuan._doAdjustStock(\'' + id + '\',1)" class="pb-btn pb-btn-primary"><i class="fas fa-plus"></i> Tambah</button>\
        </div>\
      </div>';
    document.body.appendChild(modal);
  }

  function _adjStockDelta(delta) {
    var input = document.getElementById('pb-adj-amount');
    if (!input) return;
    var val = (Number(input.value) || 0) + delta;
    if (val < 1) val = 1;
    input.value = val;
  }

  function _doAdjustStock(id, direction) {
    var amount = Number(document.getElementById('pb-adj-amount').value) || 1;
    var autoExpCheckbox = document.getElementById('pb-adj-auto-exp');
    var result = adjustStock(id, amount * direction);
    // Auto-create expense when adding stock with harga beli
    if (result && result.delta > 0 && result.hargaBeli > 0) {
      var shouldAutoExp = autoExpCheckbox ? autoExpCheckbox.checked : false;
      if (shouldAutoExp) {
        var totalCost = result.delta * result.hargaBeli;
        addExpense('Tambah stok: ' + result.name + ' (+' + result.delta + ' ' + result.unit + ')', 'bahan_baku', totalCost, _now(), true);
      }
    }
    document.querySelector('.pb-modal-bg').remove();
    _renderStok(document.getElementById('pb-content'));
  }

  function _deleteStock(id) {
    var item = getStockItem(id);
    if (!item) return;
    if (!confirm('Hapus stok "' + item.name + '"?\n\nData yang dihapus tidak bisa dikembalikan.')) return;
    deleteStockItem(id);
    _renderStok(document.getElementById('pb-content'));
  }

  // =============================================
  // RENDER: PRODUKSI
  // =============================================
  function _renderProduksi(container) {
    _loadInv();
    _loadProd();

    var bahanBaku = _inventory.filter(function(item) { return item.category === 'bahan_baku'; });
    var produkJadi = _inventory.filter(function(item) { return item.category === 'produk_jadi'; });
    var todayProd = _production.filter(function(p) { return (p.date || '').substring(0, 10) === _today(); });

    var fromOptions = '<option value="">-- Pilih Bahan --</option>';
    for (var i = 0; i < bahanBaku.length; i++) {
      fromOptions += '<option value="' + bahanBaku[i].id + '">' + _escHtml(bahanBaku[i].name) + ' (sisa: ' + bahanBaku[i].stock + ' ' + _escHtml(bahanBaku[i].unit) + ')</option>';
    }

    var toOptions = '<option value="">-- Pilih Produk --</option>';
    for (var j = 0; j < produkJadi.length; j++) {
      toOptions += '<option value="' + produkJadi[j].id + '">' + _escHtml(produkJadi[j].name) + ' (stok: ' + produkJadi[j].stock + ' ' + _escHtml(produkJadi[j].unit) + ')</option>';
    }

    var prodHistory = '';
    if (_production.length === 0) {
      prodHistory = '<div class="pb-empty"><i class="fas fa-industry"></i><p>Belum ada riwayat produksi</p></div>';
    } else {
      prodHistory = '<div class="pb-prod-list">';
      var shown = _production.slice().reverse().slice(0, 50);
      for (var p = 0; p < shown.length; p++) {
        var pr = _normalizeProductionRecord(shown[p]);
        var bahanList = '';
        for (var bi = 0; bi < pr.inputs.length; bi++) {
          bahanList += (bi > 0 ? ', ' : '') + _escHtml(pr.inputs[bi].qty + ' ' + pr.inputs[bi].fromUnit + ' ' + pr.inputs[bi].fromName);
        }
        prodHistory += '<div class="pb-prod-card">\
          <div class="pb-prod-card-top">\
            <div class="pb-prod-card-info">\
              <div class="pb-prod-card-name"><i class="fas fa-cube" style="color:#059669;margin-right:4px"></i>' + _escHtml(pr.toQty + ' ' + pr.toUnit + ' ' + pr.toName) + '</div>\
              <div class="pb-prod-card-bahan">' + bahanList + '</div>\
            </div>\
            <button onclick="Pembukuan._delProduction(\'' + pr.id + '\')" class="pb-btn pb-btn-danger pb-btn-sm"><i class="fas fa-trash"></i></button>\
          </div>\
          <div class="pb-prod-card-date"><i class="fas fa-calendar-day"></i> ' + _fmtDT(pr.date) + '</div>\
        </div>';
      }
      prodHistory += '</div>';
    }

    // Quick-add status hints
    var fromHint = bahanBaku.length === 0
      ? '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px;font-size:11px;color:#B45309;margin-top:6px"><i class="fas fa-info-circle mr-1"></i>Bahan baku belum ada. Tambahkan di bawah atau di halaman <b>Stok</b>.</div>'
      : '';
    var toHint = produkJadi.length === 0
      ? '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px;font-size:11px;color:#B45309;margin-top:6px"><i class="fas fa-info-circle mr-1"></i>Produk jadi belum ada. Tambahkan di bawah atau di halaman <b>Stok</b>.</div>'
      : '';

    var unitOptions = '';
    for (var u = 0; u < UNITS.length; u++) {
      unitOptions += '<option value="' + UNITS[u] + '">' + UNITS[u] + '</option>';
    }

    // --- Stok Bahan Baku Overview ---
    var stokBBHtml = '';
    if (bahanBaku.length === 0) {
      stokBBHtml = '<div style="text-align:center;padding:14px;color:#94A3B8;font-size:12px"><i class="fas fa-box-open" style="font-size:20px;display:block;margin-bottom:4px;opacity:.5"></i>Belum ada bahan baku</div>';
    } else {
      stokBBHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">';
      for (var bb = 0; bb < bahanBaku.length; bb++) {
        var bbItem = bahanBaku[bb];
        var bbThreshold = bbItem.lowStock || 5;
        var bbIsLow = bbItem.stock <= bbThreshold;
        var bbBorder = bbIsLow ? 'border-color:#FECACA;background:#FEF2F2' : 'border-color:#E5E7EB;background:white';
        var bbStockColor = bbIsLow ? 'color:#DC2626' : 'color:#059669';
        var bbWarn = bbIsLow ? '<div style="font-size:9px;color:#DC2626"><i class="fas fa-triangle-exclamation"></i> Rendah</div>' : '';
        var bbNilai = (bbItem.hargaBeli || 0) > 0
          ? '<div style="font-size:9px;color:#94A3B8">' + _fmtIDR(bbItem.stock * bbItem.hargaBeli) + '</div>'
          : '';
        stokBBHtml += '\
          <div style="border:1px solid;border-radius:10px;padding:10px;' + bbBorder + '">\
            <div style="font-size:11px;font-weight:700;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _escHtml(bbItem.name) + '</div>\
            <div style="font-size:16px;font-weight:800;' + bbStockColor + ';margin:2px 0">' + bbItem.stock + ' <span style="font-size:10px;font-weight:500">' + _escHtml(bbItem.unit) + '</span></div>\
            ' + bbNilai + bbWarn + '\
          </div>';
      }
      stokBBHtml += '</div>';
    }

    // --- Stok Produk Jadi Overview ---
    var stokPJHtml = '';
    if (produkJadi.length > 0) {
      stokPJHtml = '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #E5E7EB">\
        <div style="font-size:11px;font-weight:600;color:#64748B;margin-bottom:8px"><i class="fas fa-utensils mr-1"></i>Stok Produk Jadi</div>\
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px">';
      for (var pj = 0; pj < produkJadi.length; pj++) {
        var pjItem = produkJadi[pj];
        stokPJHtml += '\
          <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:8px;text-align:center">\
            <div style="font-size:10px;font-weight:600;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _escHtml(pjItem.name) + '</div>\
            <div style="font-size:15px;font-weight:800;color:#047857">' + pjItem.stock + ' <span style="font-size:9px;font-weight:500">' + _escHtml(pjItem.unit) + '</span></div>\
          </div>';
      }
      stokPJHtml += '</div></div>';
    }

    container.innerHTML = '\
      <div class="pb-stat-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">\
        <div class="pb-stat"><div class="pb-stat-label">Produksi Hari Ini</div><div class="pb-stat-val blue">' + todayProd.length + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Total Produksi</div><div class="pb-stat-val emerald">' + _production.length + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Bahan Baku</div><div class="pb-stat-val">' + bahanBaku.length + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Produk Jadi</div><div class="pb-stat-val">' + produkJadi.length + '</div></div>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-boxes-stacked" style="color:#059669"></i> Stok Tersedia <span style="font-size:10px;color:#94A3B8;font-weight:400">otomatis update saat ada penambahan</span></div>' +
        stokBBHtml + stokPJHtml + '\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-industry" style="color:#059669"></i> Produksi Baru</div>\
        <div id="pb-prod-result" style="margin-bottom:12px"></div>\
        <div style="margin-bottom:12px">\
          <label class="pb-label"><i class="fas fa-utensils mr-1"></i>Hasil Produksi (Produk Jadi)</label>\
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">\
            <select id="pb-prod-to" class="pb-select" style="width:100%">' + toOptions + '</select>' + toHint + '\
            <input type="number" id="pb-prod-qty" class="pb-input" style="width:100%" value="1" min="1" placeholder="Jumlah hasil">\
          </div>\
        </div>\
        <div style="margin-bottom:10px">\
          <label class="pb-label"><i class="fas fa-box-open mr-1"></i> Bahan Baku yang Dipakai</label>\
          <div id="pb-prod-inputs">\
            <div class="pb-prod-input-row" style="display:grid;grid-template-columns:1fr 100px 32px;gap:6px;margin-bottom:6px;align-items:end">\
              <select class="pb-select pb-prod-from-sel" style="width:100%"><option value="">-- Pilih Bahan --</option>' + fromOptions + '</select>\
              <input type="number" class="pb-input pb-prod-from-qty" style="width:100%" placeholder="Qty" min="0" value="1">\
              <button onclick="Pembukuan._removeProdInput(this)" class="pb-btn pb-btn-danger pb-btn-sm" style="height:38px;padding:0"><i class="fas fa-xmark"></i></button>\
            </div>\
          </div>' + fromHint + '\
          <button onclick="Pembukuan._addProdInputRow()" class="pb-btn pb-btn-ghost pb-btn-sm" style="margin-top:4px"><i class="fas fa-plus"></i> Tambah Bahan</button>\
        </div>\
        <button onclick="Pembukuan._doProduction()" class="pb-btn pb-btn-primary" style="width:100%"><i class="fas fa-arrow-right-arrow-left"></i> Proses Produksi</button>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-bolt" style="color:#F59E0B"></i> Quick Add Stok</div>\
        <div style="font-size:11px;color:#64748B;margin-bottom:10px">Tambahkan bahan baku atau produk jadi langsung di sini. Stok akan otomatis muncul di atas.</div>\
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end">\
          <div>\
            <label class="pb-label">Nama</label>\
            <input type="text" id="pb-qa-name" class="pb-input" placeholder="Contoh: Ayam Mentah">\
          </div>\
          <div>\
            <label class="pb-label">Kategori</label>\
            <select id="pb-qa-cat" class="pb-select" style="width:100%">\
              <option value="bahan_baku">Bahan Baku</option>\
              <option value="produk_jadi">Produk Jadi</option>\
            </select>\
          </div>\
          <div>\
            <label class="pb-label">Satuan</label>\
            <select id="pb-qa-unit" class="pb-select" style="width:100%">' + unitOptions + '</select>\
          </div>\
          <div>\
            <button onclick="Pembukuan._quickAddStock()" class="pb-btn pb-btn-primary pb-btn-sm" style="margin-bottom:1px;height:40px"><i class="fas fa-plus"></i></button>\
          </div>\
        </div>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-clock-rotate-left" style="color:#64748B"></i> Riwayat Produksi</div>' +
        prodHistory +
      '</div>';
  }

  function _quickAddStock() {
    var name = document.getElementById('pb-qa-name').value.trim();
    var cat = document.getElementById('pb-qa-cat').value;
    var unit = document.getElementById('pb-qa-unit').value;
    if (!name) { alert('Nama item wajib diisi!'); return; }
    addStockItem(name, 0, unit, cat);
    // Re-render produksi page to refresh dropdowns
    _renderProduksi(document.getElementById('pb-content'));
  }

  // --- Dynamic input rows for multi-bahan produksi ---
  function _addProdInputRow() {
    var container = document.getElementById('pb-prod-inputs');
    if (!container) return;
    _loadInv();
    var bahanBaku = _inventory.filter(function(item) { return item.category === 'bahan_baku'; });
    var fromOpts = '<option value="">-- Pilih Bahan --</option>';
    for (var i = 0; i < bahanBaku.length; i++) {
      fromOpts += '<option value="' + bahanBaku[i].id + '">' + _escHtml(bahanBaku[i].name) + ' (sisa: ' + bahanBaku[i].stock + ' ' + _escHtml(bahanBaku[i].unit) + ')</option>';
    }
    var row = document.createElement('div');
    row.className = 'pb-prod-input-row';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 100px 32px;gap:6px;margin-bottom:6px;align-items:end';
    row.innerHTML = '\
      <select class="pb-select pb-prod-from-sel" style="width:100%">' + fromOpts + '</select>\
      <input type="number" class="pb-input pb-prod-from-qty" style="width:100%" placeholder="Qty" min="0" value="1">\
      <button onclick="Pembukuan._removeProdInput(this)" class="pb-btn pb-btn-danger pb-btn-sm" style="height:38px;padding:0"><i class="fas fa-xmark"></i></button>';
    container.appendChild(row);
  }

  function _removeProdInput(btn) {
    var container = document.getElementById('pb-prod-inputs');
    var rows = container.querySelectorAll('.pb-prod-input-row');
    if (rows.length <= 1) { alert('Minimal harus ada 1 bahan baku!'); return; }
    btn.closest('.pb-prod-input-row').remove();
  }

  function _doProduction() {
    var toId = document.getElementById('pb-prod-to').value;
    var toQty = document.getElementById('pb-prod-qty').value;

    if (!toId) { alert('Pilih produk jadi!'); return; }
    if (!toQty || Number(toQty) < 1) { alert('Jumlah hasil minimal 1!'); return; }

    // Collect all input rows
    var rows = document.querySelectorAll('#pb-prod-inputs .pb-prod-input-row');
    var inputs = [];
    var hasError = false;
    for (var r = 0; r < rows.length; r++) {
      var sel = rows[r].querySelector('.pb-prod-from-sel');
      var qtyInput = rows[r].querySelector('.pb-prod-from-qty');
      if (!sel || !qtyInput) continue;
      var fromId = sel.value;
      var qty = Number(qtyInput.value) || 0;
      if (fromId && qty > 0) {
        inputs.push({ fromId: fromId, qty: qty });
      } else if (fromId && qty <= 0) {
        hasError = true;
      }
    }

    if (inputs.length === 0) { alert('Pilih minimal 1 bahan baku dengan jumlah yang valid!'); return; }
    if (hasError) { alert('Pastikan semua bahan baku yang dipilih memiliki jumlah yang valid (> 0)!'); return; }

    // Check for duplicate bahan baku
    var seen = {};
    for (var d = 0; d < inputs.length; d++) {
      if (seen[inputs[d].fromId]) {
        var dupItem = null;
        for (var fi = 0; fi < _inventory.length; fi++) {
          if (_inventory[fi].id === inputs[d].fromId) { dupItem = _inventory[fi]; break; }
        }
        alert('Bahan baku "' + (dupItem ? dupItem.name : '') + '" dipilih lebih dari 1x. Gabungkan jumlahnya ke 1 baris.');
        return;
      }
      seen[inputs[d].fromId] = true;
    }

    var result = addProduction(inputs, toId, Number(toQty));
    var resultEl = document.getElementById('pb-prod-result');
    if (result.ok) {
      resultEl.innerHTML = '\
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:10px;font-size:12px;color:#047857">\
          <i class="fas fa-check-circle mr-1"></i> ' + _escHtml(result.msg) + '\
        </div>';
      _renderProduksi(document.getElementById('pb-content'));
    } else {
      resultEl.innerHTML = '\
        <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:10px;font-size:12px;color:#DC2626">\
          <i class="fas fa-circle-exclamation mr-1"></i> ' + _escHtml(result.msg) + '\
        </div>';
    }
  }

  function _delProduction(id) {
    if (!confirm('Hapus riwayat produksi ini?')) return;
    deleteProduction(id);
    _renderProduksi(document.getElementById('pb-content'));
  }

  // =============================================
  // RENDER: PENGELUARAN
  // =============================================
  function _renderPengeluaran(container) {
    _loadExp();

    // Separate auto (from Stok) vs manual expenses
    var autoExps = [];
    var manualExps = [];
    for (var i = 0; i < _expenses.length; i++) {
      if (_expenses[i].auto) {
        autoExps.push(_expenses[i]);
      } else {
        manualExps.push(_expenses[i]);
      }
    }

    // Stats - manual only
    var todayManual = manualExps.filter(function(e) { return (e.date || '').substring(0, 10) === _today(); });
    var totalToday = 0;
    for (var j = 0; j < todayManual.length; j++) totalToday += Number(todayManual[j].amount) || 0;
    var totalAll = 0;
    for (var k = 0; k < manualExps.length; k++) totalAll += Number(manualExps[k].amount) || 0;

    // Category options (only operasional + lainnya, NO bahan_baku)
    var catOptions = '<option value="">-- Kategori --</option>';
    for (var c = 0; c < EXPENSE_CATS.length; c++) {
      if (EXPENSE_CATS[c].id === 'bahan_baku') continue;
      catOptions += '<option value="' + EXPENSE_CATS[c].id + '">' + EXPENSE_CATS[c].label + '</option>';
    }

    // --- SECTION: Modal Bahan Baku (Auto from Stok) ---
    var autoSection = '';
    if (autoExps.length > 0) {
      var todayAuto = autoExps.filter(function(e) { return (e.date || '').substring(0, 10) === _today(); });
      var totalAutoToday = 0;
      for (var at = 0; at < todayAuto.length; at++) totalAutoToday += Number(todayAuto[at].amount) || 0;
      var totalAutoAll = 0;
      for (var aa = 0; aa < autoExps.length; aa++) totalAutoAll += Number(autoExps[aa].amount) || 0;

      autoSection = '<div class="pb-card" style="border-left:4px solid #F59E0B;background:#FFFBEB">\
        <div class="pb-card-title" style="margin-bottom:8px"><i class="fas fa-box-open" style="color:#F59E0B"></i> Modal Bahan Baku <span style="font-size:10px;color:#94A3B8;font-weight:400">(otomatis dari Stok)</span></div>\
        <div style="display:flex;gap:16px;margin-bottom:10px">\
          <div style="font-size:12px;color:#92400E">Hari ini: <b style="color:#B45309">' + _fmtIDR(totalAutoToday) + '</b></div>\
          <div style="font-size:12px;color:#92400E">Total: <b style="color:#B45309">' + _fmtIDR(totalAutoAll) + '</b></div>\
        </div>';

      var recentAuto = autoExps.slice().reverse().slice(0, 30);
      autoSection += '<div class="pb-auto-list">';
      for (var ae = 0; ae < recentAuto.length; ae++) {
        var ax = recentAuto[ae];
        autoSection += '<div class="pb-auto-card">\
          <div class="pb-auto-card-top">\
            <div class="pb-auto-card-info">\
              <div class="pb-auto-card-name">' + _escHtml(ax.name) + '</div>\
              <span style="font-size:9px;background:#FDE68A;color:#92400E;padding:2px 6px;border-radius:4px;font-weight:600"><i class="fas fa-link" style="font-size:7px"></i> STOK</span>\
            </div>\
            <div class="pb-auto-card-amount">-' + _fmtIDR(ax.amount) + '</div>\
          </div>\
          <div class="pb-auto-card-date"><i class="fas fa-calendar-day"></i> ' + _fmtDT(ax.date) + '</div>\
        </div>';
      }
      autoSection += '</div></div>';
    } else {
      autoSection = '<div class="pb-card" style="border-left:4px solid #F59E0B;background:#FFFBEB">\
        <div class="pb-card-title"><i class="fas fa-box-open" style="color:#F59E0B"></i> Modal Bahan Baku <span style="font-size:10px;color:#94A3B8;font-weight:400">(otomatis dari Stok)</span></div>\
        <div style="text-align:center;padding:16px;color:#B45309;font-size:12px"><i class="fas fa-info-circle" style="font-size:20px;display:block;margin-bottom:6px;opacity:.5"></i>Belum ada stok masuk. Tambah stok dengan Harga Beli di menu <b>Stok</b> untuk otomatis mencatat pengeluaran bahan baku.</div>\
      </div>';
    }

    // --- SECTION: Pengeluaran Operasional (Manual) ---
    var manualList = '';
    if (manualExps.length === 0) {
      manualList = '<div class="pb-empty"><i class="fas fa-receipt"></i><p>Belum ada pengeluaran operasional</p></div>';
    } else {
      var shown = manualExps.slice().reverse().slice(0, 100);
      manualList = '<div class="pb-expense-list">';
      for (var e = 0; e < shown.length; e++) {
        var ex = shown[e];
        var catColor = _getCatColor(EXPENSE_CATS, ex.category);
        var catLabel = _getCatLabel(EXPENSE_CATS, ex.category);
        manualList += '<div class="pb-expense-card">\
          <div class="pb-expense-card-top">\
            <div class="pb-expense-card-info">\
              <div class="pb-expense-card-name">' + _escHtml(ex.name) + '</div>\
              <span class="pb-chip pb-chip-' + catColor + '">' + _escHtml(catLabel) + '</span>\
            </div>\
            <div class="pb-expense-card-amount">-' + _fmtIDR(ex.amount) + '</div>\
          </div>\
          <div class="pb-expense-card-bottom">\
            <div class="pb-expense-card-date"><i class="fas fa-calendar-day"></i> ' + _fmtDT(ex.date) + '</div>\
            <div class="pb-expense-card-actions">\
              <button onclick="Pembukuan._showEditExpModal(\'' + ex.id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm"><i class="fas fa-pen"></i></button>\
              <button onclick="Pembukuan._delExpense(\'' + ex.id + '\')" class="pb-btn pb-btn-danger pb-btn-sm"><i class="fas fa-trash"></i></button>\
            </div>\
          </div>\
        </div>';
      }
      manualList += '</div>';
    }

    container.innerHTML = '\
      <div class="pb-stat-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">\
        <div class="pb-stat"><div class="pb-stat-label">Operasional Hari Ini</div><div class="pb-stat-val red">' + _fmtIDR(totalToday) + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Total Operasional</div><div class="pb-stat-val red">' + _fmtIDR(totalAll) + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Bahan Baku Hari Ini</div><div class="pb-stat-val" style="color:#B45309;font-size:15px">' + (function(){var t=0;for(var x=0;x<autoExps.length;x++){if((autoExps[x].date||'').substring(0,10)===_today())t+=Number(autoExps[x].amount)||0;}return _fmtIDR(t);})() + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Jumlah Operasional</div><div class="pb-stat-val blue">' + manualExps.length + '</div></div>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-plus-circle" style="color:#059669"></i> Tambah Pengeluaran Operasional</div>\
        <div style="margin-bottom:10px">\
          <label class="pb-label">Nama Pengeluaran</label>\
          <input type="text" id="pb-exp-name" class="pb-input" placeholder="Contoh: Bayar Listrik, Gaji Karyawan">\
        </div>\
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">\
          <div>\
            <label class="pb-label">Kategori</label>\
            <select id="pb-exp-cat" class="pb-select" style="width:100%">' + catOptions + '</select>\
          </div>\
          <div>\
            <label class="pb-label">Jumlah (Rp)</label>\
            <input type="number" id="pb-exp-amount" class="pb-input" placeholder="0" min="0">\
          </div>\
        </div>\
        <div style="margin-bottom:12px">\
          <label class="pb-label">Tanggal</label>\
          <input type="datetime-local" id="pb-exp-date" class="pb-input" value="' + _today() + 'T' + String(new Date().getHours()).padStart(2, '0') + ':' + String(new Date().getMinutes()).padStart(2, '0') + '">\
        </div>\
        <button onclick="Pembukuan._addExpenseUI()" class="pb-btn pb-btn-primary" style="width:100%"><i class="fas fa-plus"></i> Simpan Pengeluaran</button>\
      </div>' +
      autoSection +
      '<div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-clock-rotate-left" style="color:#64748B"></i> Riwayat Pengeluaran Operasional</div>' +
        manualList +
      '</div>';
  }

  function _addExpenseUI() {
    var name = document.getElementById('pb-exp-name').value.trim();
    var cat = document.getElementById('pb-exp-cat').value;
    var amount = document.getElementById('pb-exp-amount').value;
    var dateVal = document.getElementById('pb-exp-date').value;

    if (!name) { alert('Nama pengeluaran wajib diisi!'); return; }
    if (!cat) { alert('Pilih kategori!'); return; }
    if (!amount || Number(amount) <= 0) { alert('Jumlah harus lebih dari 0!'); return; }
    if (cat === 'bahan_baku') { alert('Pengeluaran Bahan Baku otomatis dicatat dari Stok.\nGunakan kategori Operasional atau Lainnya.'); return; }

    // Convert datetime-local to our format
    var dateStr = dateVal ? dateVal.replace('T', ' ') + ':00' : _now();

    addExpense(name, cat, Number(amount), dateStr, false);
    _renderPengeluaran(document.getElementById('pb-content'));
  }

  function _showEditExpModal(id) {
    _loadExp();
    var exp = null;
    for (var i = 0; i < _expenses.length; i++) {
      if (_expenses[i].id === id) { exp = _expenses[i]; break; }
    }
    if (!exp) return;
    // Block editing auto-generated expenses
    if (exp.auto) { alert('Pengeluaran ini otomatis dari Stok dan tidak bisa diedit.\nUntuk mengubahnya, edit stok barang terkait.'); return; }

    var catOptions = '';
    for (var c = 0; c < EXPENSE_CATS.length; c++) {
      if (EXPENSE_CATS[c].id === 'bahan_baku') continue;
      var sel = exp.category === EXPENSE_CATS[c].id ? 'selected' : '';
      catOptions += '<option value="' + EXPENSE_CATS[c].id + '" ' + sel + '>' + EXPENSE_CATS[c].label + '</option>';
    }

    // Convert date to datetime-local format
    var dtVal = '';
    if (exp.date) {
      dtVal = exp.date.substring(0, 16);
    }

    var modal = document.createElement('div');
    modal.className = 'pb-modal-bg';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '\
      <div class="pb-modal">\
        <div class="pb-modal-header">\
          <h3><i class="fas fa-pen mr-2" style="color:#059669"></i>Edit Pengeluaran</h3>\
          <button onclick="this.closest(\'.pb-modal-bg\').remove()" style="background:none;border:none;cursor:pointer;color:#94A3B8;font-size:16px"><i class="fas fa-xmark"></i></button>\
        </div>\
        <div class="pb-modal-body">\
          <div style="margin-bottom:12px">\
            <label class="pb-label">Nama</label>\
            <input type="text" id="pb-edit-exp-name" class="pb-input" value="' + _escHtml(exp.name) + '">\
          </div>\
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">\
            <div>\
              <label class="pb-label">Kategori</label>\
              <select id="pb-edit-exp-cat" class="pb-select" style="width:100%">' + catOptions + '</select>\
            </div>\
            <div>\
              <label class="pb-label">Jumlah (Rp)</label>\
              <input type="number" id="pb-edit-exp-amount" class="pb-input" value="' + (exp.amount || 0) + '" min="0">\
            </div>\
          </div>\
          <div>\
            <label class="pb-label">Tanggal</label>\
            <input type="datetime-local" id="pb-edit-exp-date" class="pb-input" value="' + dtVal + '">\
          </div>\
        </div>\
        <div class="pb-modal-footer">\
          <button onclick="this.closest(\'.pb-modal-bg\').remove()" class="pb-btn pb-btn-ghost">Batal</button>\
          <button onclick="Pembukuan._saveEditExp(\'' + id + '\')" class="pb-btn pb-btn-primary"><i class="fas fa-check"></i> Simpan</button>\
        </div>\
      </div>';
    document.body.appendChild(modal);
  }

  function _saveEditExp(id) {
    var name = document.getElementById('pb-edit-exp-name').value.trim();
    var cat = document.getElementById('pb-edit-exp-cat').value;
    var amount = document.getElementById('pb-edit-exp-amount').value;
    var dateVal = document.getElementById('pb-edit-exp-date').value;

    if (!name) { alert('Nama wajib diisi!'); return; }
    if (!amount || Number(amount) <= 0) { alert('Jumlah harus lebih dari 0!'); return; }

    var dateStr = dateVal ? dateVal.replace('T', ' ') + ':00' : _now();
    editExpense(id, { name: name, category: cat, amount: Number(amount), date: dateStr });

    document.querySelector('.pb-modal-bg').remove();
    _renderPengeluaran(document.getElementById('pb-content'));
  }

  function _delExpense(id) {
    _loadExp();
    for (var i = 0; i < _expenses.length; i++) {
      if (_expenses[i].id === id && _expenses[i].auto) {
        alert('Pengeluaran ini otomatis dari Stok dan tidak bisa dihapus.\nHapus stok barang terkait untuk menghapus pengeluaran ini.');
        return;
      }
    }
    if (!confirm('Hapus pengeluaran ini?')) return;
    deleteExpense(id);
    _renderPengeluaran(document.getElementById('pb-content'));
  }

  // =============================================
  // RENDER: PENJUALAN (READ-ONLY)
  // =============================================
  function _renderPenjualan(container) {
    _reportDate = _reportDate || _today();

    container.innerHTML = '\
      <div class="pb-card">\
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">\
          <i class="fas fa-filter" style="color:#64748B"></i>\
          <input type="date" id="pb-sales-date" class="pb-input" style="flex:1" value="' + _reportDate + '" onchange="Pembukuan._loadSalesView()">\
        </div>\
        <div id="pb-sales-summary"></div>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-chart-line" style="color:#0284C7"></i> Daftar Transaksi</div>\
        <div id="pb-sales-list"><div style="text-align:center;padding:20px;color:#94A3B8;font-size:13px"><i class="fas fa-spinner fa-spin"></i> Memuat data...</div></div>\
      </div>';

    _loadSalesView();
  }

  function _loadSalesView() {
    var dateInput = document.getElementById('pb-sales-date');
    if (dateInput) _reportDate = dateInput.value;

    _invalidateSalesCache();
    _loadSales(function(sales) {
      var filtered = [];
      var totalSales = 0;
      for (var i = 0; i < sales.length; i++) {
        if ((sales[i].date || '').substring(0, 10) === _reportDate) {
          filtered.push(sales[i]);
          totalSales += Number(sales[i].total) || 0;
        }
      }

      // Summary
      var summaryEl = document.getElementById('pb-sales-summary');
      if (summaryEl) {
        summaryEl.innerHTML = '\
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">\
            <div style="background:#EFF6FF;border-radius:12px;padding:14px;text-align:center">\
              <div style="font-size:11px;color:#64748B;font-weight:600">Transaksi</div>\
              <div style="font-size:24px;font-weight:800;color:#0284C7">' + filtered.length + '</div>\
            </div>\
            <div style="background:#ECFDF5;border-radius:12px;padding:14px;text-align:center">\
              <div style="font-size:11px;color:#64748B;font-weight:600">Total Penjualan</div>\
              <div style="font-size:24px;font-weight:800;color:#059669">' + _fmtIDR(totalSales) + '</div>\
            </div>\
          </div>';
      }

      // List
      var listEl = document.getElementById('pb-sales-list');
      if (!listEl) return;

      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="pb-empty"><i class="fas fa-cash-register"></i><p>Tidak ada transaksi pada tanggal ini</p></div>';
        return;
      }

      var html = '';
      var sorted = filtered.slice().reverse();
      for (var j = 0; j < sorted.length; j++) {
        var trx = sorted[j];
        var itemsHtml = '';
        for (var k = 0; k < (trx.items || []).length; k++) {
          itemsHtml += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">\
            <span style="color:#475569">' + _escHtml(trx.items[k].nama_menu) + ' x' + trx.items[k].qty + '</span>\
            <span style="font-weight:600">' + _fmtIDR(trx.items[k].harga * trx.items[k].qty) + '</span>\
          </div>';
        }

        html += '\
          <div style="border:1px solid #E5E7EB;border-radius:12px;padding:12px;margin-bottom:8px">\
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">\
              <div>\
                <span style="font-size:11px;color:#64748B">' + _fmtDT(trx.date) + '</span>\
                <span class="pb-chip pb-chip-green" style="margin-left:6px">' + _escHtml(trx.table || '-') + '</span>\
              </div>\
              <div style="font-weight:800;color:#059669;font-size:14px">' + _fmtIDR(trx.total) + '</div>\
            </div>\
            <div style="border-top:1px dashed #E5E7EB;padding-top:6px">\
              ' + itemsHtml + '\
            </div>\
            <div style="margin-top:6px;font-size:11px;color:#94A3B8">\
              <i class="fas fa-' + (trx.paymentMethod === 'Tunai' ? 'money-bill-wave' : trx.paymentMethod === 'QRIS' ? 'qrcode' : 'building-columns') + ' mr-1"></i>' + _escHtml(trx.paymentMethod || '-') + '\
              ' + (trx.cashier ? '&middot; <i class="fas fa-user mr-1"></i>' + _escHtml(trx.cashier) : '') + '\
            </div>\
          </div>';
      }
      listEl.innerHTML = html;
    });
  }

  // =============================================
  // RENDER: LAPORAN
  // =============================================
  function _renderLaporan(container) {
    if (!_reportDate) _reportDate = _today();
    if (!_reportPeriod) _reportPeriod = 'daily';

    var dateVal = _reportPeriod === 'daily' ? _today() : _thisMonth();

    container.innerHTML = '\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-calendar-days" style="color:#059669"></i> Filter Laporan</div>\
        <div style="display:flex;gap:8px;margin-bottom:12px">\
          <button onclick="Pembukuan._setReportPeriod(\'daily\')" id="pb-rpt-daily" class="pb-btn pb-btn-primary pb-btn-sm">Harian</button>\
          <button onclick="Pembukuan._setReportPeriod(\'monthly\')" id="pb-rpt-monthly" class="pb-btn pb-btn-ghost pb-btn-sm">Bulanan</button>\
        </div>\
        <div id="pb-rpt-date-input">\
          <input type="date" id="pb-rpt-date" class="pb-input" value="' + dateVal + '" onchange="Pembukuan._loadReport()">\
        </div>\
      </div>\
      <div id="pb-rpt-content"><div style="text-align:center;padding:30px;color:#94A3B8"><i class="fas fa-spinner fa-spin"></i> Memuat laporan...</div></div>';

    // Set active period button
    if (_reportPeriod === 'monthly') {
      document.getElementById('pb-rpt-daily').className = 'pb-btn pb-btn-ghost pb-btn-sm';
      document.getElementById('pb-rpt-monthly').className = 'pb-btn pb-btn-primary pb-btn-sm';
      // Change input to month picker
      document.getElementById('pb-rpt-date').type = 'month';
    }

    _loadReport();
  }

  function _setReportPeriod(period) {
    _reportPeriod = period;
    var dateInput = document.getElementById('pb-rpt-date');
    if (period === 'daily') {
      _reportDate = _today();
      if (dateInput) { dateInput.type = 'date'; dateInput.value = _reportDate; }
      document.getElementById('pb-rpt-daily').className = 'pb-btn pb-btn-primary pb-btn-sm';
      document.getElementById('pb-rpt-monthly').className = 'pb-btn pb-btn-ghost pb-btn-sm';
    } else {
      _reportDate = _thisMonth();
      if (dateInput) { dateInput.type = 'month'; dateInput.value = _reportDate; }
      document.getElementById('pb-rpt-daily').className = 'pb-btn pb-btn-ghost pb-btn-sm';
      document.getElementById('pb-rpt-monthly').className = 'pb-btn pb-btn-primary pb-btn-sm';
    }
    _loadReport();
  }

  function _loadReport() {
    var dateInput = document.getElementById('pb-rpt-date');
    var dateVal = dateInput ? dateInput.value : _today();
    var contentEl = document.getElementById('pb-rpt-content');
    if (!contentEl) return;

    calcReport(_reportPeriod, dateVal).then(function(report) {
      var profitColor = report.profit >= 0 ? 'color:#059669' : 'color:#DC2626';
      var profitIcon = report.profit >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';

      // Expense breakdown
      var expBreakdown = '';
      var cats = Object.keys(report.expByCat);
      if (cats.length > 0) {
        expBreakdown = '<div style="margin-top:12px;border-top:1px dashed #E5E7EB;padding-top:12px">\
          <div style="font-size:12px;font-weight:600;color:#64748B;margin-bottom:8px">Rincian Pengeluaran:</div>';
        for (var c = 0; c < cats.length; c++) {
          var catColor = _getCatColor(EXPENSE_CATS, cats[c]);
          var catLabel = _getCatLabel(EXPENSE_CATS, cats[c]);
          var pct = report.totalExpenses > 0 ? Math.round(report.expByCat[cats[c]] / report.totalExpenses * 100) : 0;
          expBreakdown += '\
            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">\
              <span class="pb-chip pb-chip-' + catColor + '">' + _escHtml(catLabel) + '</span>\
              <span style="font-weight:600;color:#DC2626;font-size:12px">' + _fmtIDR(report.expByCat[cats[c]]) + ' <span style="color:#94A3B8;font-weight:400">(' + pct + '%)</span></span>\
            </div>';
        }
        expBreakdown += '</div>';
      }

      contentEl.innerHTML = '\
        <div class="pb-stat-grid" style="grid-template-columns:1fr 1fr">\
          <div class="pb-stat" style="border-left:4px solid #0284C7">\
            <div class="pb-stat-label"><i class="fas fa-cart-shopping mr-1"></i>Penjualan</div>\
            <div class="pb-stat-val blue">' + _fmtIDR(report.totalSales) + '</div>\
            <div style="font-size:10px;color:#94A3B8;margin-top:2px">' + report.trxCount + ' transaksi</div>\
          </div>\
          <div class="pb-stat" style="border-left:4px solid ' + (report.profit >= 0 ? '#059669' : '#DC2626') + '">\
            <div class="pb-stat-label"><i class="fas ' + profitIcon + ' mr-1"></i>PROFIT</div>\
            <div class="pb-stat-val" style="' + profitColor + '">' + (report.profit >= 0 ? '' : '-') + _fmtIDR(Math.abs(report.profit)) + '</div>\
            <div style="font-size:10px;color:#94A3B8;margin-top:2px">' + (report.profit >= 0 ? 'Untung' : 'Rugi') + '</div>\
          </div>\
        </div>\
        <div class="pb-stat-grid" style="grid-template-columns:1fr 1fr 1fr">\
          <div class="pb-stat" style="border-left:3px solid #F59E0B">\
            <div class="pb-stat-label"><i class="fas fa-box-open mr-1"></i>Modal Bahan</div>\
            <div class="pb-stat-val" style="color:#B45309;font-size:15px">' + _fmtIDR(report.totalExpBB) + '</div>\
          </div>\
          <div class="pb-stat" style="border-left:3px solid #6366F1">\
            <div class="pb-stat-label"><i class="fas fa-wrench mr-1"></i>Operasional</div>\
            <div class="pb-stat-val" style="color:#4F46E5;font-size:15px">' + _fmtIDR(report.totalExpOps) + '</div>\
          </div>\
          <div class="pb-stat" style="border-left:3px solid #10B981">\
            <div class="pb-stat-label"><i class="fas fa-warehouse mr-1"></i>Nilai Stok</div>\
            <div class="pb-stat-val" style="color:#047857;font-size:15px">' + _fmtIDR(report.totalInventoryValue) + '</div>\
          </div>\
        </div>\
        <div class="pb-card" style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border-color:#A7F3D0">\
          <div style="text-align:center;padding:8px 0">\
            <div style="font-size:12px;color:#64748B;font-weight:600;margin-bottom:4px">Rumus: Penjualan - Modal Bahan - Operasional = Profit</div>\
            <div style="font-size:13px;color:#475569">\
              <b>' + _fmtIDR(report.totalSales) + '</b> - <b style="color:#B45309">' + _fmtIDR(report.totalExpBB) + '</b> - <b style="color:#4F46E5">' + _fmtIDR(report.totalExpOps) + '</b> = \
              <b style="' + profitColor + '">' + (report.profit >= 0 ? '' : '-') + _fmtIDR(Math.abs(report.profit)) + '</b>\
            </div>\
            <div style="font-size:11px;color:#94A3B8;margin-top:6px"><i class="fas fa-warehouse mr-1"></i>Nilai Stok Saat Ini: <b style="color:#047857">' + _fmtIDR(report.totalInventoryValue) + '</b> (stok x harga beli, bukan periode)</div>\
          </div>' +
          expBreakdown +
        '</div>';
    });
  }

  // =============================================
  // RENDER: PANDUAN (User Guide)
  // =============================================
  function _toggleGuideSection(id) {
    var body = document.getElementById(id);
    var arrow = document.getElementById(id + '-arrow');
    if (body) {
      body.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
    }
  }

  function _renderPanduan(container) {
    container.innerHTML = '\
      <div class="pb-guide-hero">\
        <div style="font-size:36px;margin-bottom:8px"><i class="fas fa-book-open"></i></div>\
        <h2>Panduan Pembukuan WARKOPOS</h2>\
        <p>Panduan lengkap penggunaan fitur pembukuan.<br>Klik setiap topik di bawah untuk membaca penjelasannya.</p>\
      </div>\
      <!-- 1. ALUR KERJA -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-1\')">\
          <div class="pb-guide-sec-icon" style="background:#ECFDF5;color:#047857"><i class="fas fa-route"></i></div>\
          <div class="pb-guide-sec-title">Alur Kerja Pembukuan</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-1-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-1">\
          <div style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:12px">\
            Pembukuan WARKOPOS dirancang agar sesuai dengan alur kerja usaha Anda sehari-hari. Berikut adalah urutan yang direkomendasikan agar catatan keuangan Anda akurat dan terintegrasi secara otomatis.\
          </div>\
          <div class="pb-guide-flow">\
            <div class="pb-guide-flow-item"><i class="fas fa-1" style="color:#059669;margin-right:6px"></i> Belanja Bahan Baku di Pasar</div>\
            <div class="pb-guide-flow-arrow"><i class="fas fa-arrow-down"></i></div>\
            <div class="pb-guide-flow-item"><i class="fas fa-2" style="color:#059669;margin-right:6px"></i> Catat di <strong>Stok</strong> (nama, jumlah, harga beli)</div>\
            <div class="pb-guide-flow-arrow"><i class="fas fa-arrow-down"></i></div>\
            <div class="pb-guide-flow-item" style="background:#ECFDF5;border-color:#A7F3D0"><i class="fas fa-robot" style="color:#047857;margin-right:6px"></i> Otomatis masuk ke <strong>Pengeluaran (Bahan Baku)</strong></div>\
            <div class="pb-guide-flow-arrow"><i class="fas fa-arrow-down"></i></div>\
            <div class="pb-guide-flow-item"><i class="fas fa-3" style="color:#059669;margin-right:6px"></i> Proses Bahan Baku di <strong>Produksi</strong></div>\
            <div class="pb-guide-flow-arrow"><i class="fas fa-arrow-down"></i></div>\
            <div class="pb-guide-flow-item"><i class="fas fa-4" style="color:#059669;margin-right:6px"></i> Jualan berjalan (tercatat otomatis di <strong>Penjualan</strong>)</div>\
            <div class="pb-guide-flow-arrow"><i class="fas fa-arrow-down"></i></div>\
            <div class="pb-guide-flow-item"><i class="fas fa-5" style="color:#059669;margin-right:6px"></i> Catat Pengeluaran <strong>Operasional</strong> jika ada</div>\
            <div class="pb-guide-flow-arrow"><i class="fas fa-arrow-down"></i></div>\
            <div class="pb-guide-flow-item" style="background:#EFF6FF;border-color:#BAE6FD"><i class="fas fa-chart-pie" style="color:#0284C7;margin-right:6px"></i> Cek <strong>Laporan</strong> di akhir hari</div>\
          </div>\
          <div class="pb-guide-tip">\
            <i class="fas fa-lightbulb"></i>\
            <div><strong>Kunci utama:</strong> Selalu catat stok dengan <strong>harga beli</strong> yang benar. Dari situ, sistem akan otomatis menghitung pengeluaran bahan baku dan menyajikan laporan profit yang akurat.</div>\
          </div>\
        </div>\
      </div>\
      <!-- 2. STOK -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-2\')">\
          <div class="pb-guide-sec-icon" style="background:#EFF6FF;color:#0284C7"><i class="fas fa-boxes-stacked"></i></div>\
          <div class="pb-guide-sec-title">Stok (Gudang Barang)</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-2-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-2">\
          <div style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:12px">\
            Fitur Stok adalah tempat Anda mencatat semua barang yang dimiliki, baik bahan baku mentah maupun produk jadi yang siap dijual. Ini adalah <strong>titik awal</strong> dari seluruh alur pembukuan.\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#EFF6FF;color:#0284C7">1</div>\
            <div class="pb-guide-step-text"><strong>Tambah Stok Baru</strong><br>Klik tombol <strong>"+ Tambah"</strong> di halaman Stok. Isi formulir: Nama Item (contoh: Ayam Mentah), Jumlah yang dibeli, Satuan (kg, pcs, liter, dll), Kategori (Bahan Baku / Produk Jadi), <strong>Harga Beli per satuan</strong>, dan Batas Stok Rendah (peringatan jika stok hampir habis).</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#EFF6FF;color:#0284C7">2</div>\
            <div class="pb-guide-step-text"><strong>Pengeluaran Otomatis</strong><br>Ketika Anda mengisi Harga Beli, sistem <strong>secara otomatis</strong> akan membuat catatan di Pengeluaran dengan kategori "Bahan Baku". Entri ini ditandai dengan lencana kuning <strong>"STOK"</strong> dan tidak bisa diedit atau dihapus manual, karena datanya bersumber dari Stok.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#EFF6FF;color:#0284C7">3</div>\
            <div class="pb-guide-step-text"><strong>Sesuaikan Stok (+/-)</strong><br>Klik ikon <strong>plus-minus</strong> untuk menambah atau mengurangi stok secara manual. Gunakan saat ada barang masuk tanpa beli (misal: barang kiriman) atau saat ada barang rusak/expired. Jika menambah stok dan mengisi harga, Anda bisa memilih apakah dicatat ke pengeluaran atau tidak.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#EFF6FF;color:#0284C7">4</div>\
            <div class="pb-guide-step-text"><strong>Edit & Hapus</strong><br>Klik ikon <strong>pensil</strong> untuk mengubah data stok (nama, harga, kategori, dll). Klik ikon <strong>tempat sampah</strong> untuk menghapus item dari daftar stok.</div>\
          </div>\
          <div class="pb-guide-example">\
            <strong>Contoh:</strong> Anda beli 5 kg ayam mentah di pasar dengan harga Rp 35.000/kg. Total belanja: Rp 175.000.<br>\
            Cara mencatat: Tambah Stok baru -> Nama: "Ayam Mentah", Stok: 5, Satuan: kg, Harga Beli: 35000.<br>\
            Hasil: Stok tercatat 5 kg, dan Pengeluaran otomatis bertambah Rp 175.000 (kategori Bahan Baku).\
          </div>\
          <div class="pb-guide-tip">\
            <i class="fas fa-lightbulb"></i>\
            <div><strong>Tips:</strong> Selalu isi <strong>Harga Beli</strong> dengan benar. Ini adalah harga modal per satuan yang akan digunakan untuk menghitung nilai stok dan pengeluaran bahan baku secara otomatis.</div>\
          </div>\
        </div>\
      </div>\
      <!-- 3. PRODUKSI -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-3\')">\
          <div class="pb-guide-sec-icon" style="background:#FDF4FF;color:#9333EA"><i class="fas fa-industry"></i></div>\
          <div class="pb-guide-sec-title">Produksi (Olah Bahan Jadi Produk)</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-3-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-3">\
          <div style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:12px">\
            Fitur Produksi digunakan ketika Anda mengolah beberapa bahan baku menjadi satu produk jadi yang siap dijual. Misalnya, mengolah tepung, ayam, dan minyak menjadi ayam goreng. Di sini, stok bahan baku akan <strong>berkurang otomatis</strong> dan stok produk jadi akan <strong>bertambah otomatis</strong>.\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FDF4FF;color:#9333EA">1</div>\
            <div class="pb-guide-step-text"><strong>Lihat Ketersediaan Stok</strong><br>Di bagian atas halaman Produksi, Anda bisa melihat sisa stok semua bahan baku dan produk jadi yang tersedia. Ini membantu Anda mengetahui apakah bahan cukup sebelum memulai produksi.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FDF4FF;color:#9333EA">2</div>\
            <div class="pb-guide-step-text"><strong>Pilih Bahan Baku</strong><br>Klik tombol <strong>"+ Produksi Baru"</strong>. Pilih bahan baku pertama dari dropdown, lalu isi jumlah yang akan dipakai. Untuk menambah bahan lain, klik tombol <strong>"+ Bahan"</strong>. Anda bisa menambahkan beberapa bahan sekaligus (misal: 2 kg ayam + 500 gram tepung + 200 ml minyak).</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FDF4FF;color:#9333EA">3</div>\
            <div class="pb-guide-step-text"><strong>Pilih Produk Jadi</strong><br>Pilih produk jadi yang dihasilkan dari dropdown (pastikan produk jadi sudah didaftarkan di Stok dengan kategori "Produk Jadi"). Isi berapa jumlah/banyak produk yang dihasilkan.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FDF4FF;color:#9333EA">4</div>\
            <div class="pb-guide-step-text"><strong>Proses Produksi</strong><br>Klik <strong>"Proses"</strong>. Sistem akan otomatis: (a) Mengurangi stok bahan baku yang dipakai, (b) Menambah stok produk jadi, (c) Mencatat riwayat produksi di halaman yang sama.</div>\
          </div>\
          <div class="pb-guide-example">\
            <strong>Contoh:</strong> Membuat 10 porsi Ayam Goreng.<br>\
            Bahan yang dipakai: 2 kg Ayam Mentah + 500 gram Tepung + 200 ml Minyak Goreng<br>\
            Produk jadi: 10 pcs Ayam Goreng<br>\
            Hasil: Stok Ayam Mentah berkurang 2 kg, Tepung berkurang 500 gram, Minyak berkurang 200 ml. Stok Ayam Goreng bertambah 10 pcs.\
          </div>\
          <div class="pb-guide-tip">\
            <i class="fas fa-triangle-exclamation"></i>\
            <div><strong>Perhatian:</strong> Jika stok bahan baku tidak cukup, produksi akan dibatalkan dan muncul pesan peringatan. Pastikan selalu cek ketersediaan stok sebelum memproses. Jika produk jadi belum ada di daftar Stok, tambahkan dulu melalui halaman Stok dengan kategori "Produk Jadi".</div>\
          </div>\
        </div>\
      </div>\
      <!-- 4. PENGELUARAN -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-4\')">\
          <div class="pb-guide-sec-icon" style="background:#FEF2F2;color:#DC2626"><i class="fas fa-receipt"></i></div>\
          <div class="pb-guide-sec-title">Pengeluaran (Uang Keluar)</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-4-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-4">\
          <div style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:12px">\
            Fitur Pengeluaran mencatat semua uang yang keluar dari kas usaha Anda. Ada dua jenis pengeluaran yang ditangani secara berbeda oleh sistem, dan penting untuk memahami perbedaannya.\
          </div>\
          <div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:12px;margin-bottom:12px">\
            <div style="display:flex;gap:10px;margin-bottom:10px">\
              <div style="flex:1;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px">\
                <div style="font-size:11px;font-weight:700;color:#B45309;margin-bottom:4px"><i class="fas fa-box-open" style="margin-right:4px"></i> Bahan Baku</div>\
                <div style="font-size:10px;color:#92400E;line-height:1.5"><strong>Otomatis dari Stok.</strong> Tidak perlu dicatat manual. Entri ini muncul sendiri saat Anda menambah stok dengan harga beli. Ditandai dengan lencana kuning "STOK".</div>\
              </div>\
              <div style="flex:1;background:#EFF6FF;border:1px solid #BAE6FD;border-radius:8px;padding:10px">\
                <div style="font-size:11px;font-weight:700;color:#1D4ED8;margin-bottom:4px"><i class="fas fa-wrench" style="margin-right:4px"></i> Operasional</div>\
                <div style="font-size:10px;color:#1E40AF;line-height:1.5"><strong>Dicatat manual.</strong> Untuk biaya sehari-hari: gas, listrik, gaji karyawan, sewa, transportasi, dll. Gunakan tombol "+ Tambah".</div>\
              </div>\
            </div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FEF2F2;color:#DC2626">1</div>\
            <div class="pb-guide-step-text"><strong>Menambah Pengeluaran Manual</strong><br>Klik tombol <strong>"+ Tambah"</strong>. Isi: Nama pengeluaran (contoh: "Beli Gas LPG 5kg"), Kategori (Operasional / Lainnya), Jumlah uang (Rp), dan Tanggal. Klik Simpan.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FEF2F2;color:#DC2626">2</div>\
            <div class="pb-guide-step-text"><strong>Entri Otomatis (STOK)</strong><br>Entri berwarna <strong>kuning</strong> dengan lencana "STOK" adalah pengeluaran bahan baku yang dibuat otomatis dari fitur Stok. Entri ini <strong>tidak bisa diedit atau dihapus</strong> secara manual. Untuk mengubahnya, edit data Stok terkait.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FEF2F2;color:#DC2626">3</div>\
            <div class="pb-guide-step-text"><strong>Edit & Hapus</strong><br>Hanya pengeluaran manual (Operasional/Lainnya) yang bisa diedit atau dihapus. Klik ikon pensil untuk mengubah atau ikon tempat sampah untuk menghapus.</div>\
          </div>\
          <div class="pb-guide-tip">\
            <i class="fas fa-lightbulb"></i>\
            <div><strong>Penting:</strong> Jangan menambah pengeluaran Bahan Baku secara manual, karena sudah otomatis dari Stok. Cukup fokus mencatat pengeluaran Operasional dan Lainnya di sini.</div>\
          </div>\
        </div>\
      </div>\
      <!-- 5. PENJUALAN -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-5\')">\
          <div class="pb-guide-sec-icon" style="background:#ECFDF5;color:#047857"><i class="fas fa-chart-line"></i></div>\
          <div class="pb-guide-sec-title">Penjualan (Uang Masuk)</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-5-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-5">\
          <div style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:12px">\
            Fitur Penjualan menampilkan data transaksi yang berasal dari <strong>mesin POS (Kasir)</strong>. Data ini diambil secara otomatis, artinya Anda tidak perlu mencatat penjualan manual di pembukuan. Setiap kali Anda menyelesaikan transaksi di POS, data penjualan akan langsung muncul di sini.\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#ECFDF5;color:#047857">1</div>\
            <div class="pb-guide-step-text"><strong>Daftar Transaksi</strong><br>Halaman Penjualan menampilkan semua riwayat transaksi: tanggal, nama pesanan, jumlah item, dan total harga. Anda bisa menggunakan fitur pencarian untuk menemukan transaksi tertentu berdasarkan nama menu atau nomor meja.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#ECFDF5;color:#047857">2</div>\
            <div class="pb-guide-step-text"><strong>Ringkasan Hari Ini</strong><br>Di bagian atas ditampilkan ringkasan: total pendapatan hari ini dan jumlah transaksi. Ini membantu Anda memantau performa penjualan secara real-time tanpa harus menghitung manual.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#ECFDF5;color:#047857">3</div>\
            <div class="pb-guide-step-text"><strong>Data Read-Only</strong><br>Data penjualan tidak bisa diedit atau dihapus dari Pembukuan karena bersumber langsung dari POS. Jika ada kesalahan transaksi, perbaiki melalui fitur Riwayat di halaman POS.</div>\
          </div>\
          <div class="pb-guide-tip">\
            <i class="fas fa-lightbulb"></i>\
            <div><strong>Tips:</strong> Setiap selesai berjualan, cek halaman Penjualan untuk memastikan semua transaksi tercatat. Jika ada transaksi yang tidak muncul, kemungkinan belum selesai (belum dibayar) di POS.</div>\
          </div>\
        </div>\
      </div>\
      <!-- 6. LAPORAN -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-6\')">\
          <div class="pb-guide-sec-icon" style="background:#FFF7ED;color:#EA580C"><i class="fas fa-file-invoice-dollar"></i></div>\
          <div class="pb-guide-sec-title">Laporan (Keuangan Harian & Bulanan)</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-6-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-6">\
          <div style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:12px">\
            Fitur Laporan adalah tujuan akhir dari seluruh pembukuan. Di sini Anda bisa melihat ringkasan keuangan: berapa uang masuk, berapa uang keluar, dan berapa keuntungan bersih dalam satu hari atau satu bulan. Laporan mengambil data dari Penjualan, Pengeluaran, dan Stok secara otomatis.\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FFF7ED;color:#EA580C">1</div>\
            <div class="pb-guide-step-text"><strong>Pilih Periode</strong><br>Di bagian atas, pilih antara <strong>"Harian"</strong> (satu hari tertentu) atau <strong>"Bulanan"</strong> (satu bulan penuh). Gunakan tombol panah kiri/kanan atau klik tanggal/bulan untuk memilih periode yang ingin dilihat.</div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FFF7ED;color:#EA580C">2</div>\
            <div class="pb-guide-step-text"><strong>Membaca Angka-angka Laporan</strong><br>\
              <strong style="color:#059669">Penjualan:</strong> Total uang masuk dari semua transaksi POS di periode tersebut.<br>\
              <strong style="color:#B45309">Pengeluaran Bahan Baku:</strong> Total uang keluar untuk belanja bahan (otomatis dari Stok).<br>\
              <strong style="color:#1D4ED8">Pengeluaran Operasional:</strong> Total biaya operasional (dicatat manual).<br>\
              <strong style="display:inline-block;padding:1px 8px;border-radius:4px;font-size:11px" class="pb-badge">Profit</strong> = Penjualan - Pengeluaran Bahan Baku - Pengeluaran Operasional.<br>\
              <strong style="color:#64748B">Nilai Stok:</strong> Perkiraan nilai total barang yang masih tersisa di gudang (stok x harga beli). Ini hanya informasi, bukan uang kas.\
            </div>\
          </div>\
          <div class="pb-guide-step">\
            <div class="pb-guide-step-num" style="background:#FFF7ED;color:#EA580C">3</div>\
            <div class="pb-guide-step-text"><strong>Detail Transaksi</strong><br>Scroll ke bawah untuk melihat daftar rincian: setiap transaksi penjualan dan setiap pengeluaran yang terjadi di periode tersebut.</div>\
          </div>\
          <div class="pb-guide-example">\
            <strong>Contoh Laporan Harian:</strong><br>\
            Penjualan: Rp 500.000 (10 transaksi)<br>\
            Pengeluaran Bahan Baku: Rp 200.000 (beli ayam, tepung, minyak)<br>\
            Pengeluaran Operasional: Rp 50.000 (gas, listrik)<br>\
            <strong>Profit = Rp 500.000 - Rp 200.000 - Rp 50.000 = Rp 250.000</strong><br>\
            Nilai Stok Tersisa: Rp 150.000 (sisa barang di gudang) -> ini info saja, bukan uang kas.\
          </div>\
          <div class="pb-guide-tip">\
            <i class="fas fa-lightbulb"></i>\
            <div><strong>Tips:</strong> Cek laporan setiap akhir hari untuk mengetahui apakah usaha hari ini untung atau rugi. Jika profit minus, evaluasi pengeluaran operational atau sesuaikan harga jual produk.</div>\
          </div>\
        </div>\
      </div>\
      <!-- 7. ISTILAH & FAQ -->\
      <div class="pb-guide-section">\
        <div class="pb-guide-sec-header" onclick="Pembukuan._toggleGuideSection(\'pb-guide-7\')">\
          <div class="pb-guide-sec-icon" style="background:#F1F5F9;color:#475569"><i class="fas fa-circle-question"></i></div>\
          <div class="pb-guide-sec-title">Istilah Penting & Pertanyaan Umum</div>\
          <i class="fas fa-chevron-down pb-guide-sec-arrow" id="pb-guide-7-arrow"></i>\
        </div>\
        <div class="pb-guide-sec-body" id="pb-guide-7">\
          <div style="font-size:13px;font-weight:700;color:#1E293B;margin-bottom:10px">Istilah yang Perlu Dipahami:</div>\
          <div style="margin-bottom:14px">\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Bahan Baku</strong> &mdash; Bahan mentah yang dibeli untuk diolah menjadi produk jual. Contoh: ayam mentah, tepung, minyak goreng, gula, kopi.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Produk Jadi</strong> &mdash; Hasil olahan dari bahan baku yang siap dijual ke pelanggan. Contoh: ayam goreng, kopi susu, nasi goreng.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Harga Beli</strong> &mdash; Harga modal per satuan saat Anda membeli bahan baku. Bukan harga jual ke pelanggan. Contoh: Rp 35.000/kg untuk ayam mentah.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Nilai Stok</strong> &mdash; Perkiraan nilai uang yang "terikat" di barang yang masih tersisa di gudang. Dihitung: jumlah stok x harga beli. Ini hanya informasi referensi, bukan uang kas yang benar-benar ada.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Profit</strong> &mdash; Keuntungan bersih = Total Penjualan dikurangi Total Pengeluaran (Bahan Baku + Operasional). Angka ini menunjukkan apakah usaha Anda untung atau rugi di periode tersebut.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0">\
              <strong>Operasional</strong> &mdash; Biaya harian untuk menjalankan usaha selain bahan baku. Contoh: gas LPG, listrik, air, gaji karyawan, sewa tempat, transportasi.\
            </div>\
          </div>\
          <div style="font-size:13px;font-weight:700;color:#1E293B;margin-bottom:10px">Pertanyaan Umum (FAQ):</div>\
          <div style="margin-bottom:14px">\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Q: Kenapa ada pengeluaran yang tidak bisa dihapus?</strong><br>\
              A: Pengeluaran dengan lencana kuning "STOK" dibuat otomatis dari fitur Stok. Untuk mengubahnya, edit atau hapus item stok terkait di halaman Stok.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Q: Apakah "Nilai Stok" dihitung sebagai uang keluar?</strong><br>\
              A: Tidak. Nilai Stok hanya menampilkan perkiraan nilai barang di gudang. Nilai Stok tidak masuk ke perhitungan Profit. Profit dihitung hanya dari Penjualan dikurangi Pengeluaran yang sudah terjadi.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0;border-bottom:1px solid #F1F5F9">\
              <strong>Q: Bagaimana jika saya beli bahan tapi tidak ingat harga per satuan?</strong><br>\
              A: Isi saja total harga beli pada jumlah satuan yang Anda catat. Misal, beli 3 kg ayam total Rp 100.000, maka isi harga beli: Rp 33.333/kg (dibagi rata). Sistem akan menghitung pengeluaran otomatis berdasarkan harga yang Anda isi.\
            </div>\
            <div style="font-size:12px;color:#374151;line-height:1.7;padding:8px 0">\
              <strong>Q: Data pembukuan tersimpan di mana?</strong><br>\
              A: Semua data disimpan di perangkat Anda (localStorage browser). Data tidak dikirim ke server manapun. Pastikan tidak menghapus data browser jika tidak ingin kehilangan catatan.\
            </div>\
          </div>\
        </div>\
      </div>\
      <!-- FOOTER -->\
      <div style="text-align:center;padding:16px 0 8px;font-size:11px;color:#94A3B8">\
        <i class="fas fa-heart" style="color:#F87171;margin:0 2px"></i> WARKOPOS Pembukuan v2.0 &mdash; Sistem pembukuan sederhana untuk usaha Anda\
      </div>';
  }

  // =============================================
  // INITIALIZATION
  // =============================================
  function _init() {
    _uid = _uid_();
    _initialized = true;
    _switchPage('stok');
  }

  // Auto-init when DOM is ready
  function _boot() {
    _injectCSS();
    _injectModeSelect();
    _injectView();
    // Inject POS nav button after POS loads
    setTimeout(function() {
      _injectPOSSwitchBtn();
      _highlightPOSNav();
      // Patch switchPage to preserve Pembukuan nav button styling
      _patchSwitchPage();
    }, 500);
  }

  // Patch switchPage so it doesn't reset Pembukuan nav button
  function _patchSwitchPage() {
    var _origSwitchPage = (typeof window.switchPage === 'function') ? window.switchPage : null;
    if (!_origSwitchPage) return;
    var _patched = false;
    if (window.switchPage && window.switchPage._pbPatched) return; // already patched

    window.switchPage = function(page) {
      _origSwitchPage(page);
      // Restore Pembukuan nav button styling after switchPage resets all .nav-btn
      var pbNav = document.getElementById('nav-pembukuan');
      if (pbNav) {
        pbNav.classList.remove('text-sky-600', 'bg-sky-50', 'border-sky-600', 'text-gray-400');
        pbNav.classList.add('text-emerald-600');
      }
    };
    window.switchPage._pbPatched = true;
  }

  // Run boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  // =============================================
  // PUBLIC API
  // =============================================
  return {
    switchPage: _switchPage,
    // Internal methods exposed for onclick handlers (prefixed with _)
    _renderStokFiltered: _renderStokFiltered,
    _filterStokSearch: _filterStokSearch,
    _showAddStockModal: _showAddStockModal,
    _showEditStockModal: _showEditStockModal,
    _saveStock: _saveStock,
    _updateStockValuePreview: _updateStockValuePreview,
    _adjustStockModal: _adjustStockModal,
    _adjStockDelta: _adjStockDelta,
    _doAdjustStock: _doAdjustStock,
    _deleteStock: _deleteStock,
    _doProduction: _doProduction,
    _addProdInputRow: _addProdInputRow,
    _removeProdInput: _removeProdInput,
    _quickAddStock: _quickAddStock,
    _delProduction: _delProduction,
    _addExpenseUI: _addExpenseUI,
    _showEditExpModal: _showEditExpModal,
    _saveEditExp: _saveEditExp,
    _delExpense: _delExpense,
    _loadSalesView: _loadSalesView,
    _setReportPeriod: _setReportPeriod,
    _loadReport: _loadReport,
    _toggleGuideSection: _toggleGuideSection,
    // Data access
    addStockItem: addStockItem,
    editStockItem: editStockItem,
    deleteStockItem: deleteStockItem,
    addExpense: addExpense,
    addProduction: addProduction,
    calcReport: calcReport
  };
})();
