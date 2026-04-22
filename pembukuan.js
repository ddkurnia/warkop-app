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
  // PRODUCTION CRUD
  // =============================================
  function addProduction(fromId, toId, qty) {
    _loadInv();
    _loadProd();

    var fromItem = null, toItem = null;
    for (var i = 0; i < _inventory.length; i++) {
      if (_inventory[i].id === fromId) fromItem = _inventory[i];
      if (_inventory[i].id === toId) toItem = _inventory[i];
    }

    if (!fromItem) return { ok: false, msg: 'Bahan baku tidak ditemukan' };
    if (!toItem) return { ok: false, msg: 'Produk jadi tidak ditemukan' };
    if (fromItem.stock < Number(qty)) return { ok: false, msg: 'Stok "' + fromItem.name + '" tidak cukup! Sisa: ' + fromItem.stock + ' ' + fromItem.unit };

    fromItem.stock -= Number(qty);
    toItem.stock += Number(qty);

    _production.push({
      id: _genId(),
      fromId: fromId,
      fromName: fromItem.name,
      toId: toId,
      toName: toItem.name,
      qty: Number(qty),
      date: _now()
    });

    _saveInv();
    _saveProd();
    return { ok: true, msg: 'Produksi berhasil: ' + qty + ' ' + fromItem.unit + ' ' + fromItem.name + ' → ' + toItem.name };
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
.pb-content{max-width:700px;margin:0 auto;padding:16px;padding-bottom:40px;flex:1 1 0%!important;min-height:0!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}\
.pb-card{background:white;border-radius:16px;border:1px solid #E5E7EB;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04)}\
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
.pb-table{width:100%;border-collapse:collapse;font-size:12px}\
.pb-table th{text-align:left;padding:8px 10px;color:#64748B;font-weight:600;border-bottom:2px solid #E5E7EB;font-size:11px;text-transform:uppercase;letter-spacing:.5px}\
.pb-table td{padding:10px;border-bottom:1px solid #F1F5F9;vertical-align:middle}\
.pb-table tr:hover td{background:#F8FAFC}\
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
    var pages = ['stok', 'produksi', 'pengeluaran', 'penjualan', 'laporan'];
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

    var html = '<table class="pb-table"><thead><tr><th>Nama</th><th>Kategori</th><th>Stok</th><th>Harga Beli</th><th>Nilai</th><th>Aksi</th></tr></thead><tbody>';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var threshold = item.lowStock || 5;
      var isLow = item.stock <= threshold;
      var stockColor = isLow ? 'color:#DC2626;font-weight:700' : 'color:#059669;font-weight:700';
      var catLabel = _getCatLabel(STOCK_CATS, item.category);
      var nilai = (item.stock || 0) * (item.hargaBeli || 0);
      html += '<tr id="pb-stock-row-' + item.id + '">\
        <td><div style="font-weight:600;color:#1E293B">' + _escHtml(item.name) + '</div>' + (isLow ? '<div style="font-size:10px;color:#DC2626"><i class="fas fa-triangle-exclamation"></i> Min: ' + threshold + ' ' + _escHtml(item.unit) + '</div>' : '') + '</td>\
        <td><span class="pb-chip pb-chip-green">' + _escHtml(catLabel) + '</span></td>\
        <td style="' + stockColor + '">' + item.stock + ' ' + _escHtml(item.unit) + '</td>\
        <td style="font-size:11px;color:#64748B">' + (item.hargaBeli ? _fmtIDR(item.hargaBeli) + '/' + _escHtml(item.unit) : '-') + '</td>\
        <td style="font-weight:600;color:#1E293B;font-size:12px">' + _fmtIDR(nilai) + '</td>\
        <td>\
          <button onclick="Pembukuan._showEditStockModal(\'' + item.id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm" title="Edit"><i class="fas fa-pen"></i></button>\
          <button onclick="Pembukuan._adjustStockModal(\'' + item.id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm" title="Sesuaikan Stok"><i class="fas fa-plus-minus"></i></button>\
          <button onclick="Pembukuan._deleteStock(\'' + item.id + '\')" class="pb-btn pb-btn-danger pb-btn-sm" title="Hapus"><i class="fas fa-trash"></i></button>\
        </td>\
      </tr>';
    }
    html += '</tbody></table>';
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
      prodHistory = '<table class="pb-table"><thead><tr><th>Tanggal</th><th>Bahan</th><th>Produk</th><th>Qty</th><th></th></tr></thead><tbody>';
      var shown = _production.slice().reverse().slice(0, 50);
      for (var p = 0; p < shown.length; p++) {
        var pr = shown[p];
        prodHistory += '<tr>\
          <td style="font-size:11px;color:#64748B">' + _fmtDT(pr.date) + '</td>\
          <td>' + _escHtml(pr.fromName) + '</td>\
          <td style="font-weight:600;color:#059669">' + _escHtml(pr.toName) + '</td>\
          <td style="font-weight:700">' + pr.qty + '</td>\
          <td><button onclick="Pembukuan._delProduction(\'' + pr.id + '\')" class="pb-btn pb-btn-danger pb-btn-sm"><i class="fas fa-trash"></i></button></td>\
        </tr>';
      }
      prodHistory += '</tbody></table>';
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

    container.innerHTML = '\
      <div class="pb-stat-grid">\
        <div class="pb-stat"><div class="pb-stat-label">Hari Ini</div><div class="pb-stat-val blue">' + todayProd.length + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Total Produksi</div><div class="pb-stat-val emerald">' + _production.length + '</div></div>\
        <div class="pb-stat"><div class="pb-stat-label">Bahan Baku</div><div class="pb-stat-val">' + bahanBaku.length + '</div></div>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-industry" style="color:#059669"></i> Produksi Baru</div>\
        <div id="pb-prod-result" style="margin-bottom:12px"></div>\
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:12px;align-items:start">\
          <div>\
            <label class="pb-label">Bahan Baku</label>\
            <select id="pb-prod-from" class="pb-select" style="width:100%">' + fromOptions + '</select>' + fromHint + '\
          </div>\
          <div>\
            <label class="pb-label">Produk Jadi</label>\
            <select id="pb-prod-to" class="pb-select" style="width:100%">' + toOptions + '</select>' + toHint + '\
          </div>\
          <div>\
            <label class="pb-label">Qty</label>\
            <input type="number" id="pb-prod-qty" class="pb-input" style="width:80px" value="1" min="1">\
          </div>\
        </div>\
        <button onclick="Pembukuan._doProduction()" class="pb-btn pb-btn-primary" style="width:100%"><i class="fas fa-arrow-right-arrow-left"></i> Proses Produksi</button>\
      </div>\
      <div class="pb-card">\
        <div class="pb-card-title"><i class="fas fa-bolt" style="color:#F59E0B"></i> Quick Add Stok</div>\
        <div style="font-size:11px;color:#64748B;margin-bottom:10px">Tambahkan bahan baku atau produk jadi langsung di sini tanpa pindah halaman.</div>\
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

  function _doProduction() {
    var fromId = document.getElementById('pb-prod-from').value;
    var toId = document.getElementById('pb-prod-to').value;
    var qty = document.getElementById('pb-prod-qty').value;

    if (!fromId || !toId) { alert('Pilih bahan baku dan produk jadi!'); return; }
    if (!qty || Number(qty) < 1) { alert('Jumlah minimal 1!'); return; }

    var result = addProduction(fromId, toId, qty);
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
      autoSection += '<table class="pb-table"><thead><tr><th>Tanggal</th><th>Nama</th><th>Jumlah</th></tr></thead><tbody>';
      for (var ae = 0; ae < recentAuto.length; ae++) {
        var ax = recentAuto[ae];
        autoSection += '<tr>\
          <td style="font-size:11px;color:#64748B">' + _fmtDT(ax.date) + '</td>\
          <td><span style="font-size:9px;background:#FDE68A;color:#92400E;padding:2px 5px;border-radius:4px;font-weight:600"><i class="fas fa-link" style="font-size:7px"></i> STOK</span> ' + _escHtml(ax.name) + '</td>\
          <td style="font-weight:700;color:#B45309">-' + _fmtIDR(ax.amount) + '</td>\
        </tr>';
      }
      autoSection += '</tbody></table></div>';
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
      manualList = '<table class="pb-table"><thead><tr><th>Tanggal</th><th>Nama</th><th>Kategori</th><th>Jumlah</th><th></th></tr></thead><tbody>';
      var shown = manualExps.slice().reverse().slice(0, 100);
      for (var e = 0; e < shown.length; e++) {
        var ex = shown[e];
        var catColor = _getCatColor(EXPENSE_CATS, ex.category);
        var catLabel = _getCatLabel(EXPENSE_CATS, ex.category);
        manualList += '<tr>\
          <td style="font-size:11px;color:#64748B">' + _fmtDT(ex.date) + '</td>\
          <td style="font-weight:600">' + _escHtml(ex.name) + '</td>\
          <td><span class="pb-chip pb-chip-' + catColor + '">' + _escHtml(catLabel) + '</span></td>\
          <td style="font-weight:700;color:#DC2626">-' + _fmtIDR(ex.amount) + '</td>\
          <td>\
            <button onclick="Pembukuan._showEditExpModal(\'' + ex.id + '\')" class="pb-btn pb-btn-ghost pb-btn-sm"><i class="fas fa-pen"></i></button>\
            <button onclick="Pembukuan._delExpense(\'' + ex.id + '\')" class="pb-btn pb-btn-danger pb-btn-sm"><i class="fas fa-trash"></i></button>\
          </td>\
        </tr>';
      }
      manualList += '</tbody></table>';
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
    _quickAddStock: _quickAddStock,
    _delProduction: _delProduction,
    _addExpenseUI: _addExpenseUI,
    _showEditExpModal: _showEditExpModal,
    _saveEditExp: _saveEditExp,
    _delExpense: _delExpense,
    _loadSalesView: _loadSalesView,
    _setReportPeriod: _setReportPeriod,
    _loadReport: _loadReport,
    // Data access
    addStockItem: addStockItem,
    editStockItem: editStockItem,
    deleteStockItem: deleteStockItem,
    addExpense: addExpense,
    addProduction: addProduction,
    calcReport: calcReport
  };
})();
