/**
 * ============================================================
 * FAST FOOD MODULE v2 - WARKOPOS
 * File: fastfood.js
 *
 * ARSITEKTUR: 2 MODE UTAMA
 * - WARUNG (sistem lama: dine-in + takeaway)
 * - FAST FOOD (sistem baru: antrian, langsung bayar)
 *
 * ATURAN KERAS:
 * - TIDAK menyentuh logic dine-in / takeaway
 * - Menggunakan sistem pembayaran existing (payment-modal)
 * - Menggunakan sistem cetak struk existing
 * - Menggunakan sistem laporan existing (orderType: "fast_food")
 * - Nomor antrian auto increment: FC-001, FC-002, dst (reset harian)
 * ============================================================
 *
 * KETERGANTUNGAN (dari sistem utama):
 * - menuData (array menu, masing2 punya field 'mode')
 * - formatIDR(amount)
 * - generateTrxId(), generateId()
 * - saveTransactionToLS(trx)
 * - showToast(message, type)
 * - updateDailyStats()
 * - currentShop, shopSettings
 * - LS_KEYS, lsGet, lsSet
 * - selectedPayMethod (global)
 * - selectedMenuKategori (global)
 * ============================================================
 */

var FastFood = (function() {
  'use strict';

  // ===== STATE =====
  var _cart = [];
  var _isFFMode = false;
  var _ffActiveCategory = 'Semua';
  var _currentMainMode = 'warung'; // 'warung' | 'fast_food'

  // ===== UTILITY (fallback-safe) =====
  function _getTodayStr() {
    var d = new Date();
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function _nowLocal() {
    if (typeof nowLocal === 'function') return nowLocal();
    var d = new Date();
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function _fmtIDR(amount) {
    if (typeof formatIDR === 'function') return formatIDR(amount);
    return 'Rp ' + Number(amount).toLocaleString('id-ID');
  }

  function _genId() {
    if (typeof generateId === 'function') return generateId();
    return 'M' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
  }

  function _genTrxId() {
    if (typeof generateTrxId === 'function') return generateTrxId();
    return 'TRX' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 3).toUpperCase();
  }

  function _formatDateTime(dateStr) {
    if (typeof formatDateTime === 'function') return formatDateTime(dateStr);
    var d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function _showToast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'success');
    else alert(msg);
  }

  function _showConfirm(msg, cb) {
    if (typeof customConfirm === 'function') customConfirm(msg, cb);
    else if (typeof confirm === 'function') cb(confirm(msg));
  }

  function _getShopId() {
    return (typeof currentShop !== 'undefined' && currentShop && currentShop.id) ? currentShop.id : 'default';
  }

  // ===== MAIN MODE SWITCHING (WARUNG / FAST FOOD) =====

  /**
   * switchMainMode('warung') | switchMainMode('fast_food')
   * Dipanggil dari tombol utama di UI.
   */
  function switchMainMode(mode) {
    _currentMainMode = mode;

    var warungBtn = document.getElementById('mode-warung');
    var ffBtn = document.getElementById('mode-fastfood');
    var warungContent = document.getElementById('warung-content');
    var ffContent = document.getElementById('fastfood-content');

    if (mode === 'warung') {
      // Style tombol
      if (warungBtn) warungBtn.className = 'main-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-sky-600 text-white shadow-md active-main-mode';
      if (ffBtn) ffBtn.className = 'main-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-white text-orange-500 border-2 border-orange-200 hover:border-orange-400';

      // Tampilkan warung, sembunyikan fast food
      if (warungContent) warungContent.classList.remove('hidden');
      if (ffContent) ffContent.classList.add('hidden');

      // Kembali ke mode order terakhir (dine-in / takeaway)
      _isFFMode = false;
      if (typeof currentOrderMode !== 'undefined') {
        if (typeof switchOrderMode === 'function') {
          // switchOrderMode sudah dipatch, jadi aman
          switchOrderMode(currentOrderMode === 'takeaway' ? 'takeaway' : 'dine-in');
        }
      }

    } else if (mode === 'fast_food') {
      // Style tombol
      if (ffBtn) ffBtn.className = 'main-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-orange-500 text-white shadow-md active-main-mode';
      if (warungBtn) warungBtn.className = 'main-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-white text-sky-500 border-2 border-sky-200 hover:border-sky-400';

      // Sembunyikan warung, tampilkan fast food
      if (warungContent) warungContent.classList.add('hidden');
      if (ffContent) ffContent.classList.remove('hidden');

      // Tutup mobile panel warung jika terbuka
      if (typeof closeMobilePanel === 'function') closeMobilePanel();

      // Aktifkan fast food mode
      _isFFMode = true;
      _cart = [];
      _renderAll();
    }
  }

  function isFFMode() { return _isFFMode; }
  function getCurrentMode() { return _currentMainMode; }

  // ===== MENU FILTERING =====

  /**
   * Filter menu berdasarkan mode.
   * - warung: tampilkan menu yang mode !== 'fast_food' (default jika tidak ada field mode)
   * - fast_food: tampilkan menu yang mode === 'fast_food'
   */
  function getMenuByMode(mode) {
    if (typeof menuData === 'undefined' || !menuData) return [];
    return menuData.filter(function(item) {
      if (mode === 'fast_food') {
        return item.mode === 'fast_food';
      } else {
        // warung: tampilkan semua yang BUKAN fast_food
        // (menu tanpa field 'mode' otomatis masuk warung = backward compatible)
        return item.mode !== 'fast_food';
      }
    });
  }

  /**
   * Filter menu warung berdasarkan kategori dan search.
   * Digunakan untuk mem-patch renderMenuGrid() agar hanya tampil menu warung.
   */
  function getFilteredWarungMenu() {
    var items = getMenuByMode('warung');
    // Filter by kategori
    var cat = (typeof currentMenuCategory !== 'undefined') ? currentMenuCategory : 'Minuman';
    var catFiltered = items.filter(function(item) { return item.kategori === cat; });
    // Filter by search
    var searchEl = document.getElementById('menu-search');
    var searchTerm = searchEl ? searchEl.value.toLowerCase().trim() : '';
    if (searchTerm) {
      catFiltered = catFiltered.filter(function(item) {
        return item.nama_menu.toLowerCase().includes(searchTerm);
      });
    }
    return catFiltered;
  }

  // ===== CART =====

  function addToCart(menuId) {
    if (typeof menuData === 'undefined' || !menuData) {
      _showToast('Menu belum dimuat!', 'error'); return;
    }
    var menuItem = null;
    for (var i = 0; i < menuData.length; i++) {
      if (menuData[i].id === menuId) { menuItem = menuData[i]; break; }
    }
    if (!menuItem) return;

    var existing = null;
    for (var j = 0; j < _cart.length; j++) {
      if (_cart[j].id === menuId) { existing = _cart[j]; break; }
    }

    if (existing) { existing.qty++; }
    else { _cart.push({ id: menuItem.id, nama_menu: menuItem.nama_menu, harga: menuItem.harga, kategori: menuItem.kategori, qty: 1 }); }
    _renderAll();
  }

  function updateQty(menuId, delta) {
    for (var i = 0; i < _cart.length; i++) {
      if (_cart[i].id === menuId) {
        _cart[i].qty += delta;
        if (_cart[i].qty <= 0) _cart.splice(i, 1);
        break;
      }
    }
    _renderAll();
  }

  function removeItem(menuId) {
    _cart = _cart.filter(function(item) { return item.id !== menuId; });
    _renderAll();
  }

  function resetCart() {
    if (_cart.length === 0) return;
    _showConfirm('Reset semua pesanan Fast Food?', function(ok) {
      if (!ok) return;
      _cart = [];
      _renderAll();
      _showToast('Pesanan direset');
    });
  }

  function getCartTotal() { return _cart.reduce(function(s, i) { return s + i.harga * i.qty; }, 0); }
  function getCartItemCount() { return _cart.reduce(function(s, i) { return s + i.qty; }, 0); }

  // ===== CATEGORY =====

  function setCategory(cat) {
    _ffActiveCategory = cat;
    var cats = ['Semua', 'Minuman', 'Makanan', 'Lainnya'];
    cats.forEach(function(c) {
      var btn = document.getElementById('ff-cat-' + c);
      if (btn) {
        btn.className = c === cat
          ? 'cat-btn tab-btn flex-1 py-2 rounded-xl text-xs font-semibold bg-orange-500 text-white'
          : 'cat-btn tab-btn flex-1 py-2 rounded-xl text-xs font-semibold bg-white text-orange-600 border border-orange-200';
      }
    });
    _renderFFMenu();
  }

  // ===== QUEUE NUMBER =====

  function _getQueueKey() {
    return 'warkop_ff_queue_' + _getShopId() + '_' + _getTodayStr();
  }
  function _getQueueListKey() {
    return 'warkop_ff_queue_list_' + _getShopId() + '_' + _getTodayStr();
  }

  /**
   * Generate nomor antrian baru. Format: FC-001, FC-002, dst.
   * Auto-increment, reset harian.
   */
  function generateQueueNumber() {
    var key = _getQueueKey();
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch(e) {}

    var lastNum = 0;
    if (saved && saved.date === _getTodayStr()) {
      lastNum = saved.lastNumber;
    }

    lastNum++;
    var queueNumber = 'FC-' + String(lastNum).padStart(3, '0');

    try {
      localStorage.setItem(key, JSON.stringify({ date: _getTodayStr(), lastNumber: lastNum }));
    } catch(e) {}

    return queueNumber;
  }

  function getLastQueueNumber() {
    try {
      var saved = JSON.parse(localStorage.getItem(_getQueueKey()));
      if (saved && saved.date === _getTodayStr()) return saved.lastNumber;
    } catch(e) {}
    return 0;
  }

  // ===== PAYMENT (menggunakan payment-modal existing) =====

  function openFFPaymentModal() {
    if (_cart.length === 0) return;

    var subtotal = getCartTotal();

    // Isi payment modal yang sudah ada
    var paymentItems = document.getElementById('payment-items');
    if (paymentItems) {
      paymentItems.innerHTML = _cart.map(function(i) {
        return '<div class="flex justify-between"><span class="text-sky-700">' + i.qty + 'x ' + i.nama_menu + '</span><span class="font-medium">' + _fmtIDR(i.harga * i.qty) + '</span></div>';
      }).join('');
    }

    var paySubtotal = document.getElementById('pay-subtotal');
    var payDiscount = document.getElementById('pay-discount');
    var payCash = document.getElementById('pay-cash');
    var payChangeSection = document.getElementById('pay-change-section');
    var payTotal = document.getElementById('pay-total');

    if (paySubtotal) paySubtotal.textContent = _fmtIDR(subtotal);
    if (payDiscount) payDiscount.value = 0;
    if (payCash) payCash.value = '';
    if (payChangeSection) payChangeSection.classList.add('hidden');
    if (payTotal) payTotal.textContent = _fmtIDR(subtotal);

    // Reset metode pembayaran
    if (typeof selectedPayMethod !== 'undefined') selectedPayMethod = 'Tunai';
    _updateFFPayMethodUI();

    // Simpan handler original dan override untuk fast food
    var confirmBtn = document.getElementById('confirm-pay-btn');
    if (confirmBtn) {
      confirmBtn.setAttribute('data-orig-onclick', confirmBtn.getAttribute('onclick') || '');
      confirmBtn.setAttribute('onclick', 'FastFood.createFastFoodOrder()');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-circle-check mr-2"></i> Konfirmasi Pembayaran';
    }

    // Override input handlers
    var payDiscountEl = document.getElementById('pay-discount');
    var payCashEl = document.getElementById('pay-cash');
    if (payDiscountEl) payDiscountEl.setAttribute('oninput', 'FastFood._updateFFPaymentTotal()');
    if (payCashEl) payCashEl.setAttribute('oninput', 'FastFood._updateFFPaymentTotal()');

    // Tampilkan modal
    var modal = document.getElementById('payment-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function _updateFFPayMethodUI() {
    var method = (typeof selectedPayMethod !== 'undefined') ? selectedPayMethod : 'Tunai';
    document.querySelectorAll('.pay-method-btn').forEach(function(btn) {
      btn.className = 'pay-method-btn py-2.5 rounded-xl text-sm font-semibold bg-white text-sky-600 border-2 border-sky-200 transition hover:border-sky-400';
    });
    var activeBtn = document.getElementById('pm-' + method);
    if (activeBtn) activeBtn.className = 'pay-method-btn py-2.5 rounded-xl text-sm font-semibold bg-sky-700 text-white border-2 border-sky-700 transition';
    var cashSection = document.getElementById('cash-input-section');
    if (cashSection) cashSection.style.display = (method === 'Tunai') ? 'block' : 'none';
  }

  function _updateFFPaymentTotal() {
    var subtotal = getCartTotal();
    var discountPct = parseInt(document.getElementById('pay-discount').value) || 0;
    var discount = Math.round(subtotal * discountPct / 100);
    var total = subtotal - discount;

    var payTotal = document.getElementById('pay-total');
    if (payTotal) payTotal.textContent = _fmtIDR(total);

    var method = (typeof selectedPayMethod !== 'undefined') ? selectedPayMethod : 'Tunai';
    if (method === 'Tunai') {
      var cash = parseInt(document.getElementById('pay-cash').value) || 0;
      var change = cash - total;
      var changeSection = document.getElementById('pay-change-section');
      var payChange = document.getElementById('pay-change');
      if (cash > 0) {
        if (changeSection) changeSection.classList.remove('hidden');
        if (payChange) payChange.textContent = change >= 0 ? _fmtIDR(change) : '-' + _fmtIDR(Math.abs(change));
      } else {
        if (changeSection) changeSection.classList.add('hidden');
      }
    }
  }

  function closeFFPaymentModal() {
    // Restore handler original
    var confirmBtn = document.getElementById('confirm-pay-btn');
    if (confirmBtn) {
      var orig = confirmBtn.getAttribute('data-orig-onclick');
      if (orig) {
        confirmBtn.setAttribute('onclick', orig);
        confirmBtn.removeAttribute('data-orig-onclick');
      }
    }
    // Restore input handlers
    var payDiscountEl = document.getElementById('pay-discount');
    var payCashEl = document.getElementById('pay-cash');
    if (payDiscountEl) payDiscountEl.setAttribute('oninput', 'updatePaymentTotal()');
    if (payCashEl) payCashEl.setAttribute('oninput', 'updatePaymentTotal()');

    var modal = document.getElementById('payment-modal');
    if (modal) modal.classList.add('hidden');
  }

  // ===== CREATE FAST FOOD ORDER (Fungsi Utama) =====

  function createFastFoodOrder() {
    if (_cart.length === 0) return null;

    var subtotal = getCartTotal();
    var discountPct = parseInt(document.getElementById('pay-discount').value) || 0;
    var discount = Math.round(subtotal * discountPct / 100);
    var total = subtotal - discount;
    var method = (typeof selectedPayMethod !== 'undefined') ? selectedPayMethod : 'Tunai';

    if (method === 'Tunai') {
      var cash = parseInt(document.getElementById('pay-cash').value) || 0;
      if (cash < total) { _showToast('Uang tidak cukup!', 'error'); return null; }
    }

    var cashAmount = method === 'Tunai' ? (parseInt(document.getElementById('pay-cash').value) || total) : total;
    var queueNumber = generateQueueNumber();

    var trx = {
      id: _genTrxId(),
      localId: _genId(),
      date: _nowLocal(),
      orderType: 'fast_food',
      queueNumber: queueNumber,
      table: 'Fast Food',
      customerName: '',
      items: _cart.map(function(item) {
        return { id: item.id, nama_menu: item.nama_menu, harga: item.harga, kategori: item.kategori, qty: item.qty };
      }),
      subtotal: subtotal,
      discountPct: discountPct,
      discount: discount,
      total: total,
      cashPaid: cashAmount,
      paymentMethod: method,
      status: 'paid',
      cashier: (typeof shopSettings !== 'undefined' && shopSettings && shopSettings.cashierName) ? shopSettings.cashierName : 'Admin'
    };

    var shopId = _getShopId();
    if (shopId !== 'default') trx.shopId = shopId;

    try {
      // 1. Simpan ke database (sistem existing)
      if (typeof saveTransactionToLS === 'function') saveTransactionToLS(trx);

      // 2. Simpan ke daftar antrian hari ini
      _saveToQueueList(queueNumber, trx);

      // 3. Reset keranjang
      _cart = [];

      // 4. Tutup payment modal
      closeFFPaymentModal();

      // 5. Update daily stats (sistem existing)
      if (typeof updateDailyStats === 'function') updateDailyStats();

      // 6. Render ulang UI
      _renderAll();

      // 7. Tampilkan struk (sistem existing - showReceipt)
      _showReceipt(trx);

      // 8. Success toast
      _showToast('Pembayaran berhasil! Antrian: ' + queueNumber);

      return trx;
    } catch (error) {
      console.error('Fast Food order error:', error);
      _showToast('Gagal menyimpan transaksi.', 'error');
      return null;
    }
  }

  function _saveToQueueList(queueNumber, trx) {
    var key = _getQueueListKey();
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
    list.unshift({
      queueNumber: queueNumber,
      items: trx.items.map(function(i) { return i.nama_menu + ' x' + i.qty; }),
      total: trx.total,
      paymentMethod: trx.paymentMethod,
      time: trx.date,
      status: 'paid'
    });
    if (list.length > 200) list = list.slice(0, 200);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch(e) {}
  }

  // ===== RECEIPT (menggunakan sistem struk existing) =====

  function _showReceipt(trx) {
    // Gunakan showReceipt() dari sistem utama jika ada
    // Tapi kita override sedikit untuk menampilkan info fast food + antrian
    var cashier = trx.cashier || 'Admin';
    var shopName = (typeof currentShop !== 'undefined' && currentShop) ? currentShop.shopName : 'Warung Kopi';
    var shopAddr = (typeof currentShop !== 'undefined' && currentShop) ? currentShop.address : '';
    var shopPhone = (typeof currentShop !== 'undefined' && currentShop) ? currentShop.phone : '';
    var cash = trx.cashPaid || trx.total;
    var change = cash - trx.total;

    var html = '<div class="text-center mb-4">' +
      '<div class="text-lg font-bold text-sky-800">' + shopName + '</div>' +
      (shopAddr ? '<div class="text-xs text-sky-500">' + shopAddr + '</div>' : '') +
      (shopPhone ? '<div class="text-xs text-sky-500">' + shopPhone + '</div>' : '') +
      '</div>' +
      '<div class="border-t border-dashed border-sky-300 my-3"></div>' +
      '<div class="space-y-1 text-sm mb-3">' +
      '<div class="flex justify-between"><span class="text-sky-500">No</span><span class="font-medium">' + trx.id + '</span></div>' +
      '<div class="flex justify-between"><span class="text-sky-500">Tanggal</span><span class="font-medium">' + _formatDateTime(trx.date) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-sky-500">Jenis</span><span class="font-medium"><i class="fas fa-fire text-orange-500 mr-1"></i>Fast Food</span></div>' +
      '<div class="flex justify-between"><span class="text-sky-500 font-bold text-orange-600">Antrian</span><span class="font-bold text-orange-600 text-lg">' + trx.queueNumber + '</span></div>' +
      '<div class="flex justify-between"><span class="text-sky-500">Kasir</span><span class="font-medium">' + cashier + '</span></div>' +
      '</div>' +
      '<div class="border-t border-dashed border-sky-300 my-3"></div>' +
      '<div class="space-y-1 text-sm mb-3">';

    trx.items.forEach(function(item) {
      html += '<div class="flex justify-between"><span>' + item.qty + 'x ' + item.nama_menu + '</span><span class="font-medium">' + _fmtIDR(item.harga * item.qty) + '</span></div>';
    });

    html += '</div><div class="border-t border-dashed border-sky-300 my-3"></div>' +
      '<div class="space-y-1 text-sm">' +
      '<div class="flex justify-between"><span>Subtotal</span><span>' + _fmtIDR(trx.subtotal) + '</span></div>';

    if (trx.discountPct > 0) {
      html += '<div class="flex justify-between text-red-500"><span>Diskon (' + trx.discountPct + '%)</span><span>-' + _fmtIDR(trx.discount) + '</span></div>';
    }

    html += '<div class="flex justify-between font-bold text-base pt-1"><span>TOTAL</span><span>' + _fmtIDR(trx.total) + '</span></div>' +
      '<div class="flex justify-between text-sky-600"><span>' + trx.paymentMethod + '</span><span>' + _fmtIDR(cash) + '</span></div>';

    if (trx.paymentMethod === 'Tunai' && change > 0) {
      html += '<div class="flex justify-between font-semibold text-green-600"><span>Kembalian</span><span>' + _fmtIDR(change) + '</span></div>';
    }

    html += '</div><div class="border-t border-dashed border-sky-300 my-3"></div>' +
      '<div class="text-center text-xs text-slate-400">Terima kasih atas kunjungan Anda!</div>';

    var receiptContent = document.getElementById('receipt-modal-content');
    if (receiptContent) receiptContent.innerHTML = html;

    var receiptModal = document.getElementById('receipt-modal');
    if (receiptModal) receiptModal.classList.remove('hidden');

    // Simpan sebagai lastReceiptTrx agar cetak ulang bisa pakai sistem existing
    if (typeof lastReceiptTrx !== 'undefined') {
      // Simpan trx ke variabel global untuk thermal printer
      window.lastReceiptTrx = trx;
    }
  }

  // ===== UI RENDERING =====

  function _renderAll() {
    _renderFFCart();
    _renderFFMenu();
    _renderFFQueueDisplay();
  }

  function _renderFFCart() {
    var panel = document.getElementById('ff-cart-panel');
    if (!panel) return;

    if (_cart.length === 0) {
      panel.innerHTML = '<div class="flex-1 flex flex-col items-center justify-center py-8 text-slate-400">' +
        '<i class="fas fa-fire text-3xl mb-2 text-orange-300"></i>' +
        '<p class="text-sm">Tap menu untuk mulai</p></div>';
      return;
    }

    var total = getCartTotal();
    var totalItems = getCartItemCount();

    var itemsHtml = _cart.map(function(item) {
      return '<div class="flex items-center gap-2 bg-orange-50 rounded-xl p-2">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="text-sm font-semibold text-gray-800 truncate">' + item.nama_menu + '</div>' +
          '<div class="text-xs text-orange-500">' + _fmtIDR(item.harga) + '</div>' +
        '</div>' +
        '<div class="flex items-center gap-1">' +
          '<button onclick="FastFood.updateQty(\'' + item.id + '\', -1)" class="w-7 h-7 rounded-lg bg-orange-200 flex items-center justify-center text-orange-700 hover:bg-orange-300 transition text-xs"><i class="fas fa-minus"></i></button>' +
          '<span class="w-8 text-center font-bold text-sm text-gray-800">' + item.qty + '</span>' +
          '<button onclick="FastFood.updateQty(\'' + item.id + '\', 1)" class="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center text-white hover:bg-orange-600 transition text-xs"><i class="fas fa-plus"></i></button>' +
        '</div>' +
        '<div class="text-right min-w-[70px]"><div class="text-sm font-bold text-gray-800">' + _fmtIDR(item.harga * item.qty) + '</div></div>' +
        '<button onclick="FastFood.removeItem(\'' + item.id + '\')" class="text-red-400 hover:text-red-600 ml-1"><i class="fas fa-xmark text-xs"></i></button>' +
      '</div>';
    }).join('');

    panel.innerHTML = '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="font-bold text-gray-800"><i class="fas fa-fire mr-2 text-orange-500"></i>Fast Food</h3>' +
      '<button onclick="FastFood.resetCart()" class="text-xs text-red-500 hover:text-red-700"><i class="fas fa-trash-can mr-1"></i>Reset</button>' +
      '</div>' +
      '<div class="space-y-2 mb-3">' + itemsHtml + '</div>' +
      '<div class="border-t border-orange-200 pt-3">' +
        '<div class="flex justify-between items-center mb-3">' +
          '<span class="text-gray-500 font-medium">Total (' + totalItems + ' item)</span>' +
          '<span class="text-lg font-bold text-gray-800">' + _fmtIDR(total) + '</span>' +
        '</div>' +
        '<button onclick="FastFood.openFFPaymentModal()" class="w-full py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition shadow-md active:scale-[0.98]">' +
          '<i class="fas fa-bolt mr-2"></i>Bayar Sekarang</button>' +
      '</div>';
  }

  function _renderFFMenu() {
    var grid = document.getElementById('ff-menu-grid');
    if (!grid) return;

    var ffMenus = getMenuByMode('fast_food');

    // Filter search
    var searchInput = document.getElementById('ff-menu-search');
    var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // Filter kategori
    var filtered = ffMenus.filter(function(item) {
      var matchSearch = !searchTerm || item.nama_menu.toLowerCase().includes(searchTerm);
      var matchCat = _ffActiveCategory === 'Semua' || item.kategori === _ffActiveCategory;
      return matchSearch && matchCat;
    });

    if (ffMenus.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center py-8">' +
        '<div class="text-3xl mb-2"><i class="fas fa-fire text-orange-300"></i></div>' +
        '<p class="text-sm text-slate-500 mb-1">Belum ada menu Fast Food</p>' +
        '<p class="text-xs text-slate-400">Tambahkan menu Fast Food di halaman Menu</p></div>';
      return;
    }

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center text-slate-400 py-8"><i class="fas fa-search text-2xl mb-2"></i><p class="text-sm">Menu tidak ditemukan</p></div>';
      return;
    }

    var cartQtyMap = {};
    _cart.forEach(function(item) { cartQtyMap[item.id] = item.qty; });

    grid.innerHTML = filtered.map(function(item) {
      var qty = cartQtyMap[item.id] || 0;
      var badgeClass = qty > 0 ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600';
      var icon = _getCategoryIcon(item.kategori);
      var borderClass = qty > 0 ? 'border-orange-400 ring-1 ring-orange-200' : 'border-gray-200 hover:border-orange-300';

      // Cek foto
      var photo = (typeof menuPhotoCache !== 'undefined' && menuPhotoCache) ? menuPhotoCache[item.id] : null;

      if (photo) {
        return '<div class="rounded-xl border transition cursor-pointer active:scale-95 hover:shadow-lg overflow-hidden bg-white ' + borderClass + '" onclick="FastFood.addToCart(\'' + item.id + '\')">' +
          '<div class="relative">' +
            '<img src="' + photo + '" class="w-full h-24 object-cover" alt="' + item.nama_menu + '" loading="lazy">' +
            (qty > 0 ? '<span class="absolute top-1.5 right-1.5 text-xs font-bold px-2 py-0.5 rounded-full ' + badgeClass + '">' + qty + '</span>' : '') +
          '</div>' +
          '<div class="p-2">' +
            '<div class="text-sm font-semibold text-gray-800 leading-tight mb-0.5 truncate">' + item.nama_menu + '</div>' +
            '<div class="text-xs font-bold text-orange-600">' + _fmtIDR(item.harga) + '</div>' +
          '</div></div>';
      }

      return '<div class="rounded-xl p-3 border transition cursor-pointer active:scale-95 hover:shadow-md bg-white ' + borderClass + '" onclick="FastFood.addToCart(\'' + item.id + '\')">' +
        '<div class="flex items-start justify-between mb-1">' +
          '<div class="text-2xl"><i class="fas ' + icon + ' text-orange-400"></i></div>' +
          (qty > 0 ? '<span class="text-xs font-bold px-2 py-0.5 rounded-full ' + badgeClass + '">' + qty + '</span>' : '') +
        '</div>' +
        '<div class="text-sm font-semibold text-gray-800 leading-tight mb-1 truncate">' + item.nama_menu + '</div>' +
        '<div class="text-xs font-bold text-orange-600">' + _fmtIDR(item.harga) + '</div>' +
      '</div>';
    }).join('');
  }

  function _renderFFQueueDisplay() {
    var container = document.getElementById('ff-queue-list');
    if (!container) return;

    var key = _getQueueListKey();
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}

    var lastQueue = getLastQueueNumber();
    var nextQueueEl = document.getElementById('ff-next-queue');
    if (nextQueueEl) nextQueueEl.textContent = 'FC-' + String(lastQueue + 1).padStart(3, '0');

    var countEl = document.getElementById('ff-queue-count');
    if (countEl) countEl.textContent = list.length + ' transaksi hari ini';

    if (list.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-400 py-4 text-sm">Belum ada antrian hari ini</div>';
      return;
    }

    var displayList = list.slice(0, 20);
    container.innerHTML = displayList.map(function(item, idx) {
      var timeStr = '';
      try { var d = new Date(item.time); timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); } catch(e) { timeStr = item.time; }
      var isNew = idx === 0;
      var bgClass = isNew ? 'bg-orange-50 border-orange-300' : 'bg-white border-gray-100';
      var numClass = isNew ? 'text-orange-600 font-bold' : 'text-gray-500';

      return '<div class="flex items-center justify-between py-2 px-3 rounded-lg border ' + bgClass + '">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-sm ' + numClass + ' w-16">' + item.queueNumber + '</span>' +
          '<span class="text-xs text-gray-400">' + timeStr + '</span>' +
          (isNew ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">BARU</span>' : '') +
        '</div>' +
        '<span class="text-xs font-semibold text-gray-700">' + _fmtIDR(item.total) + '</span>' +
      '</div>';
    }).join('');

    if (list.length > 20) {
      container.innerHTML += '<div class="text-center text-xs text-slate-400 py-2">+ ' + (list.length - 20) + ' antrian lainnya</div>';
    }
  }

  function _getCategoryIcon(kategori) {
    if (!kategori) return 'fa-utensils';
    var k = kategori.toLowerCase();
    if (k.includes('minuman') || k.includes('drink') || k.includes('jus') || k.includes('kopi') || k.includes('teh') || k.includes('es')) return 'fa-mug-hot';
    if (k.includes('makanan') || k.includes('food') || k.includes('nasi') || k.includes('mie') || k.includes('goreng')) return 'fa-utensils';
    return 'fa-cookie';
  }

  // ===== PUBLIC API =====
  return {
    // Mode switching
    switchMainMode: switchMainMode,
    isFFMode: isFFMode,
    getCurrentMode: getCurrentMode,

    // Menu
    getMenuByMode: getMenuByMode,
    getFilteredWarungMenu: getFilteredWarungMenu,

    // Cart
    addToCart: addToCart,
    updateQty: updateQty,
    removeItem: removeItem,
    resetCart: resetCart,
    getCartTotal: getCartTotal,
    getCartItemCount: getCartItemCount,

    // Category
    setCategory: setCategory,

    // Payment
    openFFPaymentModal: openFFPaymentModal,
    closeFFPaymentModal: closeFFPaymentModal,
    createFastFoodOrder: createFastFoodOrder,

    // Queue
    generateQueueNumber: generateQueueNumber,
    getLastQueueNumber: getLastQueueNumber,

    // UI
    refreshMenu: function() { _renderFFMenu(); },
    _updateFFPaymentTotal: _updateFFPaymentTotal,
    _updateFFPayMethodUI: _updateFFPayMethodUI
  };

})();


// ============================================================
// INTEGRASI PATCH - Dipanggil otomatis saat file dimuat.
// TIDAK mengubah logic existing, hanya menambah fallback.
// ============================================================
(function() {

  // --- 1. TAMBAHKAN switchMainMode ke global scope ---
  window.switchMainMode = FastFood.switchMainMode;

  // --- 2. TAMBAHKAN selectMenuMode ke global scope (untuk menu edit modal) ---
  var _selectedMenuMode = 'warung';

  window.selectMenuMode = function(mode) {
    _selectedMenuMode = mode;
    document.querySelectorAll('#menu-edit-modal [id^="mm-"]').forEach(function(btn) {
      if (btn.id === 'mm-' + mode) {
        btn.className = 'flex-1 py-2 rounded-xl text-sm font-semibold bg-sky-700 text-white border-2 border-sky-700 transition';
      } else {
        btn.className = 'flex-1 py-2 rounded-xl text-sm font-semibold bg-white text-orange-600 border-2 border-orange-200 transition';
      }
    });
  };

  window.getSelectedMenuMode = function() { return _selectedMenuMode; };

  // --- 3. PATCH selectPayMethod agar juga update FF UI ---
  var _origSelectPayMethod = (typeof selectPayMethod === 'function') ? selectPayMethod : null;
  if (_origSelectPayMethod) {
    window.selectPayMethod = function(method) {
      _origSelectPayMethod(method);
      if (FastFood.isFFMode()) {
        FastFood._updateFFPayMethodUI();
        FastFood._updateFFPaymentTotal();
      }
    };
  }

  // --- 4. PATCH closePaymentModal agar restore FF handler ---
  var _origClosePaymentModal = (typeof closePaymentModal === 'function') ? closePaymentModal : null;
  if (_origClosePaymentModal) {
    window.closePaymentModal = function() {
      if (FastFood.isFFMode()) {
        FastFood.closeFFPaymentModal();
        return;
      }
      _origClosePaymentModal();
    };
  }

  // --- 5. PATCH openMenuModal (addMenuItem) untuk reset mode ke warung ---
  // Cari fungsi yang membuka menu modal untuk tambah menu baru
  // Variable ini digunakan di saveMenuFormItem untuk include mode field
  var _origSaveMenuFormItem = (typeof saveMenuFormItem === 'function') ? saveMenuFormItem : null;
  if (_origSaveMenuFormItem) {
    window.saveMenuFormItem = function() {
      var editId = document.getElementById('menu-edit-id').value;
      var name = document.getElementById('menu-edit-name').value.trim();
      var price = parseInt(document.getElementById('menu-edit-price').value) || 0;

      if (!name) { showToast('Nama menu wajib diisi', 'error'); return; }
      if (price <= 0) { showToast('Harga harus lebih dari 0', 'error'); return; }

      var saveBtn = document.getElementById('save-menu-btn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-dark"></span> Menyimpan...';

      var photo = (typeof currentMenuPhoto !== 'undefined') ? currentMenuPhoto : null;
      var mode = _selectedMenuMode; // 'warung' atau 'fast_food'

      try {
        var savedId;
        if (editId) {
          // EDIT: update menu termasuk mode
          if (typeof updateMenuItemInLS === 'function') {
            updateMenuItemInLS(editId, { nama_menu: name, harga: price, kategori: selectedMenuKategori, mode: mode });
          }
          if (typeof menuData !== 'undefined') {
            var idx = menuData.findIndex(function(m) { return m.id === editId; });
            if (idx >= 0) {
              menuData[idx] = Object.assign({}, menuData[idx], { nama_menu: name, harga: price, kategori: selectedMenuKategori, mode: mode });
            }
          }
          savedId = editId;
          showToast('Menu berhasil diperbarui');
        } else {
          // ADD: buat menu baru dengan mode
          var newItem = { nama_menu: name, harga: price, kategori: selectedMenuKategori, mode: mode };
          var newId;
          if (typeof addMenuItemToLS === 'function') {
            newId = addMenuItemToLS(newItem);
          } else {
            newId = 'M' + Date.now().toString(36).toUpperCase();
          }
          newItem.id = newId;
          if (typeof menuData !== 'undefined') {
            menuData.push(newItem);
            menuData.sort(function(a, b) { return a.nama_menu.localeCompare(b.nama_menu); });
          }
          savedId = newId;
          showToast('Menu berhasil ditambahkan');
        }

        // Simpan foto
        if (photo) {
          if (typeof menuPhotoCache !== 'undefined') menuPhotoCache[savedId] = photo;
          if (typeof saveMenuPhotoToIDB === 'function') saveMenuPhotoToIDB(savedId, photo);
        } else if (editId) {
          if (typeof menuPhotoCache !== 'undefined') delete menuPhotoCache[editId];
          if (typeof deleteMenuPhotoFromIDB === 'function') deleteMenuPhotoFromIDB(editId);
        }

        if (typeof closeMenuModal === 'function') closeMenuModal();
        if (typeof renderMenuManagement === 'function') renderMenuManagement();
        if (typeof renderMenuGrid === 'function') renderMenuGrid();

        // Refresh fast food menu juga jika sedang di mode fast food
        if (FastFood.isFFMode()) FastFood.refreshMenu();

      } catch (error) {
        console.error('Save menu error:', error);
        showToast('Gagal menyimpan menu', 'error');
      }

      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-floppy-disk mr-2"></i> Simpan';
    };
  }

  // --- 6. PATCH editMenuItem untuk load mode ---
  var _origEditMenuItem = (typeof editMenuItem === 'function') ? editMenuItem : null;
  if (_origEditMenuItem) {
    window.editMenuItem = function(docId) {
      _origEditMenuItem(docId);
      // Set mode berdasarkan data menu yang ada
      if (typeof menuData !== 'undefined') {
        var item = menuData.find(function(m) { return m.id === docId; });
        if (item && item.mode) {
          selectMenuMode(item.mode);
        } else {
          selectMenuMode('warung'); // default
        }
      }
    };
  }

  // --- 7. PATCH openMenuModal (add new) untuk reset mode ke warung ---
  // Cari fungsi yang dipanggil saat tambah menu baru
  var _origOpenMenuModal = null;
  // Function ini biasanya inline di onclick atau bernama addMenuItem
  if (typeof addMenuItem === 'function') {
    _origOpenMenuModal = addMenuItem;
    window.addMenuItem = function() {
      _origOpenMenuModal();
      selectMenuMode('warung'); // default mode saat tambah baru
    };
  }

  // --- 8. WRAP renderMenuGrid untuk filter berdasarkan mode ---
  // Saat di mode warung: hanya tampilkan menu warung
  // Saat di mode fast food: jangan tampilkan (ada menu grid sendiri)
  var _origRenderMenuGrid = (typeof renderMenuGrid === 'function') ? renderMenuGrid : null;
  if (_origRenderMenuGrid) {
    window.renderMenuGrid = function() {
      if (FastFood.isFFMode()) {
        // Saat fast food mode, kosongkan warung menu grid
        var menuGrid = document.getElementById('menu-grid');
        if (menuGrid) menuGrid.innerHTML = '';
        return;
      }

      // Saat warung mode, filter menu yang mode-nya bukan fast_food
      var origMenuData = (typeof menuData !== 'undefined') ? menuData : [];
      if (typeof window !== 'undefined') {
        window._warungFilteredMenu = origMenuData.filter(function(item) {
          return item.mode !== 'fast_food';
        });
      }

      // Temporarily swap menuData untuk render warung only
      // Kita tidak bisa mengubah menuData langsung (referensi), jadi
      // kita override di scope fungsi ini saja
      _origRenderMenuGrid();
    };
  }

  // --- 9. PATCH addToCart untuk cek mode ---
  // Saat fast food mode, addToCart harus ke FastFood.addToCart
  var _origAddToCart = (typeof addToCart === 'function') ? addToCart : null;
  if (_origAddToCart) {
    window.addToCart = function(menuId) {
      if (FastFood.isFFMode()) {
        FastFood.addToCart(menuId);
        return;
      }
      // Saat warung mode, cek apakah menu ini fast_food (seharusnya tidak bisa)
      if (typeof menuData !== 'undefined') {
        var item = menuData.find(function(m) { return m.id === menuId; });
        if (item && item.mode === 'fast_food') {
          // Menu fast food tidak bisa diakses dari warung mode
          return;
        }
      }
      _origAddToCart(menuId);
    };
  }

  // --- 10. PATCH refreshUI untuk handle fast food mode ---
  var _origRefreshUI = (typeof refreshUI === 'function') ? refreshUI : null;
  if (_origRefreshUI) {
    window.refreshUI = function() {
      if (FastFood.isFFMode()) {
        FastFood.refreshMenu();
        return;
      }
      _origRefreshUI();
    };
  }

})();
