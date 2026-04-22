/**
 * ============================================================
 * FAST FOOD MODULE - WARKOPOS
 * File: fastfood.js
 * 
 * FITUR: Fried Chicken Take Away Mode
 * - Modul terpisah, TIDAK menyentuh logic dine-in / takeaway
 * - Menggunakan sistem pembayaran yang sudah ada (payment-modal)
 * - Nomor antrian auto increment: FC-001, FC-002, dst
 * - Reset harian
 * ============================================================
 * 
 * CARA INTEGRASI:
 * 1. Tambahkan tombol ketiga di order-mode-tabs (lihat snippet HTML)
 * 2. Tambahkan section-fastfood di HTML (lihat snippet HTML)
 * 3. Tambahkan <script src="fastfood.js"></script> sebelum </body>
 * 
 * KETERGANTUNGAN (dari sistem utama):
 * - menuData (array menu)
 * - formatIDR(amount)
 * - generateTrxId()
 * - generateId()
 * - saveTransactionToLS(trx)
 * - showToast(message, type)
 * - updateDailyStats()
 * - currentShop (object)
 * - shopSettings (object)
 * - LS_KEYS, lsGet, lsSet
 * - selectedPayMethod (global)
 * ============================================================
 */

// ============================================================
// FAST FOOD MODULE - Self-contained namespace
// ============================================================
var FastFood = (function() {
  'use strict';

  // ===== STATE =====
  var _cart = [];              // Keranjang fast food [{id, nama_menu, harga, kategori, qty}]
  var _isFFMode = false;       // Apakah sedang di fast food mode
  var _lastQueueNumber = 0;    // Nomor antrian terakhir hari ini

  // Key localStorage untuk nomor antrian harian
  function _getQueueKey() {
    var today = _getTodayStr();
    return 'warkop_ff_queue_' + (typeof currentShop !== 'undefined' ? currentShop.id : 'default') + '_' + today;
  }

  // Key localStorage untuk daftar antrian hari ini (untuk display)
  function _getQueueListKey() {
    var today = _getTodayStr();
    return 'warkop_ff_queue_list_' + (typeof currentShop !== 'undefined' ? currentShop.id : 'default') + '_' + today;
  }

  // ===== UTILITY =====
  function _getTodayStr() {
    var d = new Date();
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function _nowLocal() {
    var d = new Date();
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function _generateId() {
    if (typeof generateId === 'function') return generateId();
    return 'M' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
  }

  function _generateTrxId() {
    if (typeof generateTrxId === 'function') return generateTrxId();
    return 'TRX' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 3).toUpperCase();
  }

  function _formatIDR(amount) {
    if (typeof formatIDR === 'function') return formatIDR(amount);
    return 'Rp ' + Number(amount).toLocaleString('id-ID');
  }

  // ===== NOMOR ANTRIAN =====
  /**
   * Generate nomor antrian baru. Format: FC-001, FC-002, dst.
   * Auto-increment per hari. Reset otomatis setiap hari baru.
   * 
   * @returns {string} Nomor antrian, contoh: "FC-001"
   */
  function generateQueueNumber() {
    var key = _getQueueKey();
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(key));
    } catch(e) { /* ignore */ }

    // Cek apakah nomor masih valid untuk hari ini
    if (saved && saved.date === _getTodayStr()) {
      _lastQueueNumber = saved.lastNumber;
    } else {
      _lastQueueNumber = 0; // Reset harian
    }

    _lastQueueNumber++;
    var queueNumber = 'FC-' + String(_lastQueueNumber).padStart(3, '0');

    // Simpan ke localStorage
    try {
      localStorage.setItem(key, JSON.stringify({
        date: _getTodayStr(),
        lastNumber: _lastQueueNumber
      }));
    } catch(e) { /* ignore */ }

    return queueNumber;
  }

  /**
   * Ambil nomor antrian terakhir hari ini (tanpa increment)
   * @returns {number} Nomor terakhir
   */
  function getLastQueueNumber() {
    var key = _getQueueKey();
    try {
      var saved = JSON.parse(localStorage.getItem(key));
      if (saved && saved.date === _getTodayStr()) return saved.lastNumber;
    } catch(e) { /* ignore */ }
    return 0;
  }

  // ===== CART MANAGEMENT =====

  /**
   * Tambah item ke keranjang fast food
   * @param {string} menuId - ID menu dari menuData
   */
  function addToCart(menuId) {
    if (typeof menuData === 'undefined' || !menuData) {
      _showToast('Menu belum dimuat!', 'error');
      return;
    }

    var menuItem = null;
    for (var i = 0; i < menuData.length; i++) {
      if (menuData[i].id === menuId) {
        menuItem = menuData[i];
        break;
      }
    }
    if (!menuItem) return;

    var existing = null;
    for (var j = 0; j < _cart.length; j++) {
      if (_cart[j].id === menuId) {
        existing = _cart[j];
        break;
      }
    }

    if (existing) {
      existing.qty++;
    } else {
      _cart.push({
        id: menuItem.id,
        nama_menu: menuItem.nama_menu,
        harga: menuItem.harga,
        kategori: menuItem.kategori,
        qty: 1
      });
    }

    _renderFFUI();
  }

  /**
   * Update jumlah item di keranjang
   * @param {string} menuId
   * @param {number} delta - +1 atau -1
   */
  function updateQty(menuId, delta) {
    for (var i = 0; i < _cart.length; i++) {
      if (_cart[i].id === menuId) {
        _cart[i].qty += delta;
        if (_cart[i].qty <= 0) {
          _cart.splice(i, 1);
        }
        break;
      }
    }
    _renderFFUI();
  }

  /**
   * Hapus item dari keranjang
   * @param {string} menuId
   */
  function removeItem(menuId) {
    _cart = _cart.filter(function(item) { return item.id !== menuId; });
    _renderFFUI();
  }

  /**
   * Reset seluruh keranjang
   */
  function resetCart() {
    if (_cart.length === 0) return;
    _showConfirm('Reset semua pesanan Fast Food?', function(ok) {
      if (!ok) return;
      _cart = [];
      _renderFFUI();
      _showToast('Pesanan direset');
    });
  }

  /**
   * Hitung total keranjang
   * @returns {number}
   */
  function getCartTotal() {
    return _cart.reduce(function(s, i) { return s + i.harga * i.qty; }, 0);
  }

  /**
   * Hitung jumlah item total
   * @returns {number}
   */
  function getCartItemCount() {
    return _cart.reduce(function(s, i) { return s + i.qty; }, 0);
  }

  // ===== PAYMENT (Menggunakan modal yang sudah ada) =====

  /**
   * Buka payment modal untuk Fast Food.
   * Menggunakan DOM payment-modal yang sudah ada di sistem.
   * TIDAK memanggil openPaymentModal() dari sistem utama.
   */
  function openFFPaymentModal() {
    if (_cart.length === 0) return;

    var subtotal = getCartTotal();

    // Isi ringkasan pesanan ke payment modal yang sudah ada
    var paymentItems = document.getElementById('payment-items');
    if (paymentItems) {
      paymentItems.innerHTML = _cart.map(function(i) {
        return '<div class="flex justify-between"><span class="text-sky-700">' + i.qty + 'x ' + i.nama_menu + '</span><span class="font-medium">' + _formatIDR(i.harga * i.qty) + '</span></div>';
      }).join('');
    }

    // Set nilai default
    var paySubtotal = document.getElementById('pay-subtotal');
    var payDiscount = document.getElementById('pay-discount');
    var payCash = document.getElementById('pay-cash');
    var payChangeSection = document.getElementById('pay-change-section');
    var payTotal = document.getElementById('pay-total');

    if (paySubtotal) paySubtotal.textContent = _formatIDR(subtotal);
    if (payDiscount) payDiscount.value = 0;
    if (payCash) payCash.value = '';
    if (payChangeSection) payChangeSection.classList.add('hidden');
    if (payTotal) payTotal.textContent = _formatIDR(subtotal);

    // Reset metode pembayaran ke Tunai
    if (typeof selectedPayMethod !== 'undefined') {
      selectedPayMethod = 'Tunai';
    }
    _updateFFPayMethodUI();

    // Tampilkan modal
    var modal = document.getElementById('payment-modal');
    if (modal) modal.classList.remove('hidden');

    // Override tombol konfirmasi untuk fast food
    var confirmBtn = document.getElementById('confirm-pay-btn');
    if (confirmBtn) {
      confirmBtn.setAttribute('data-original-onclick', confirmBtn.getAttribute('onclick') || '');
      confirmBtn.setAttribute('onclick', 'FastFood.confirmFFPayment()');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-circle-check mr-2"></i> Konfirmasi Pembayaran';
    }

    // Override discount dan cash input handler
    var payDiscountEl = document.getElementById('pay-discount');
    var payCashEl = document.getElementById('pay-cash');
    if (payDiscountEl) payDiscountEl.setAttribute('oninput', 'FastFood._updateFFPaymentTotal()');
    if (payCashEl) payCashEl.setAttribute('oninput', 'FastFood._updateFFPaymentTotal()');

    // Tutup mobile panel jika terbuka
    if (typeof closeMobilePanel === 'function') closeMobilePanel();
  }

  /**
   * Update tampilan metode pembayaran untuk fast food mode
   */
  function _updateFFPayMethodUI() {
    var method = (typeof selectedPayMethod !== 'undefined') ? selectedPayMethod : 'Tunai';
    document.querySelectorAll('.pay-method-btn').forEach(function(btn) {
      btn.className = 'pay-method-btn py-2.5 rounded-xl text-sm font-semibold bg-white text-sky-600 border-2 border-sky-200 transition hover:border-sky-400';
    });
    var activeBtn = document.getElementById('pm-' + method);
    if (activeBtn) {
      activeBtn.className = 'pay-method-btn py-2.5 rounded-xl text-sm font-semibold bg-sky-700 text-white border-2 border-sky-700 transition';
    }
    var cashSection = document.getElementById('cash-input-section');
    if (cashSection) cashSection.style.display = (method === 'Tunai') ? 'block' : 'none';
  }

  /**
   * Update total di payment modal saat discount/cash berubah
   */
  function _updateFFPaymentTotal() {
    var subtotal = getCartTotal();
    var discountPct = parseInt(document.getElementById('pay-discount').value) || 0;
    var discount = Math.round(subtotal * discountPct / 100);
    var total = subtotal - discount;
    var payTotal = document.getElementById('pay-total');
    if (payTotal) payTotal.textContent = _formatIDR(total);

    var method = (typeof selectedPayMethod !== 'undefined') ? selectedPayMethod : 'Tunai';
    if (method === 'Tunai') {
      var cash = parseInt(document.getElementById('pay-cash').value) || 0;
      var change = cash - total;
      var changeSection = document.getElementById('pay-change-section');
      var payChange = document.getElementById('pay-change');
      if (cash > 0) {
        if (changeSection) changeSection.classList.remove('hidden');
        if (payChange) payChange.textContent = change >= 0 ? _formatIDR(change) : '-' + _formatIDR(Math.abs(change));
      } else {
        if (changeSection) changeSection.classList.add('hidden');
      }
    }
  }

  /**
   * Tutup payment modal dan restore handler original
   */
  function closeFFPaymentModal() {
    // Restore tombol konfirmasi ke handler original
    var confirmBtn = document.getElementById('confirm-pay-btn');
    if (confirmBtn) {
      var originalOnclick = confirmBtn.getAttribute('data-original-onclick');
      if (originalOnclick) {
        confirmBtn.setAttribute('onclick', originalOnclick);
        confirmBtn.removeAttribute('data-original-onclick');
      }
    }

    // Restore handler input
    var payDiscountEl = document.getElementById('pay-discount');
    var payCashEl = document.getElementById('pay-cash');
    if (payDiscountEl) payDiscountEl.setAttribute('oninput', 'updatePaymentTotal()');
    if (payCashEl) payCashEl.setAttribute('oninput', 'updatePaymentTotal()');

    // Tutup modal
    var modal = document.getElementById('payment-modal');
    if (modal) modal.classList.add('hidden');
  }

  // ===== CREATE FAST FOOD ORDER (Fungsi Utama) =====

  /**
   * Fungsi utama: Buat order Fast Food.
   * Flow:
   * 1. Validasi item
   * 2. Validasi pembayaran
   * 3. Generate nomor antrian (FC-001, FC-002, dst)
   * 4. Simpan ke database (menggunakan saveTransactionToLS)
   * 5. Reset keranjang
   * 6. Tampilkan struk
   * 
   * @returns {Object|null} Transaction object atau null jika gagal
   */
  function createFastFoodOrder() {
    if (_cart.length === 0) return null;

    var subtotal = getCartTotal();
    var discountPct = parseInt(document.getElementById('pay-discount').value) || 0;
    var discount = Math.round(subtotal * discountPct / 100);
    var total = subtotal - discount;

    var method = (typeof selectedPayMethod !== 'undefined') ? selectedPayMethod : 'Tunai';

    // Validasi Tunai
    if (method === 'Tunai') {
      var cash = parseInt(document.getElementById('pay-cash').value) || 0;
      if (cash < total) {
        _showToast('Uang tidak cukup!', 'error');
        return null;
      }
    }

    var cashAmount = method === 'Tunai' ? (parseInt(document.getElementById('pay-cash').value) || total) : total;

    // Generate nomor antrian
    var queueNumber = generateQueueNumber();

    // Buat transaction object
    var trx = {
      id: _generateTrxId(),
      localId: _generateId(),
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
      cashier: (typeof shopSettings !== 'undefined' && shopSettings.cashierName) ? shopSettings.cashierName : 'Admin'
    };

    // Set shopId jika ada
    if (typeof currentShop !== 'undefined' && currentShop && currentShop.id) {
      trx.shopId = currentShop.id;
    }

    try {
      // Simpan ke database menggunakan sistem yang sudah ada
      if (typeof saveTransactionToLS === 'function') {
        saveTransactionToLS(trx);
      }

      // Simpan ke daftar antrian hari ini (untuk display)
      _saveToQueueList(queueNumber, trx);

      // Reset keranjang
      _cart = [];

      // Tutup payment modal
      closeFFPaymentModal();

      // Update daily stats
      if (typeof updateDailyStats === 'function') {
        updateDailyStats();
      }

      // Render ulang UI
      _renderFFUI();

      // Tampilkan struk
      _showReceipt(trx);

      // Tampilkan success toast dengan nomor antrian
      _showToast('Pembayaran berhasil! Antrian: ' + queueNumber);

      return trx;
    } catch (error) {
      console.error('Fast Food order error:', error);
      _showToast('Gagal menyimpan transaksi.', 'error');
      return null;
    }
  }

  /**
   * Simpan antrian ke daftar antrian hari ini
   */
  function _saveToQueueList(queueNumber, trx) {
    var key = _getQueueListKey();
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem(key)) || [];
    } catch(e) { /* ignore */ }

    list.unshift({
      queueNumber: queueNumber,
      items: trx.items.map(function(i) { return i.nama_menu + ' x' + i.qty; }),
      total: trx.total,
      paymentMethod: trx.paymentMethod,
      time: trx.date,
      status: 'paid'
    });

    // Simpan maksimal 200 antrian per hari
    if (list.length > 200) list = list.slice(0, 200);

    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch(e) { /* ignore */ }
  }

  // ===== RECEIPT (Struk) =====

  /**
   * Tampilkan struk untuk transaksi fast food
   */
  function _showReceipt(trx) {
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
      html += '<div class="flex justify-between"><span>' + item.qty + 'x ' + item.nama_menu + '</span><span class="font-medium">' + _formatIDR(item.harga * item.qty) + '</span></div>';
    });

    html += '</div><div class="border-t border-dashed border-sky-300 my-3"></div>' +
      '<div class="space-y-1 text-sm">' +
      '<div class="flex justify-between"><span>Subtotal</span><span>' + _formatIDR(trx.subtotal) + '</span></div>';

    if (trx.discountPct > 0) {
      html += '<div class="flex justify-between text-red-500"><span>Diskon (' + trx.discountPct + '%)</span><span>-' + _formatIDR(trx.discount) + '</span></div>';
    }

    html += '<div class="flex justify-between font-bold text-base pt-1"><span>TOTAL</span><span>' + _formatIDR(trx.total) + '</span></div>' +
      '<div class="flex justify-between text-sky-600"><span>' + trx.paymentMethod + '</span><span>' + _formatIDR(cash) + '</span></div>';

    if (trx.paymentMethod === 'Tunai' && change > 0) {
      html += '<div class="flex justify-between font-semibold text-green-600"><span>Kembalian</span><span>' + _formatIDR(change) + '</span></div>';
    }

    html += '</div>' +
      '<div class="border-t border-dashed border-sky-300 my-3"></div>' +
      '<div class="text-center text-xs text-slate-400">Terima kasih atas kunjungan Anda!</div>';

    var receiptContent = document.getElementById('receipt-modal-content');
    if (receiptContent) receiptContent.innerHTML = html;

    var receiptModal = document.getElementById('receipt-modal');
    if (receiptModal) receiptModal.classList.remove('hidden');
  }

  function _formatDateTime(dateStr) {
    if (typeof formatDateTime === 'function') return formatDateTime(dateStr);
    var d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  // ===== MODE SWITCHING =====

  /**
   * Buka Fast Food Mode.
   * Dipanggil dari tombol "FRIED CHICKEN" di UI.
   * TIDAK memanggil switchOrderMode() dari sistem utama.
   */
  function openFastFoodMode() {
    _isFFMode = true;

    // Reset mode tabs (nonaktifkan dine-in dan takeaway)
    var dineinBtn = document.getElementById('mode-dinein');
    var takeawayBtn = document.getElementById('mode-takeaway');
    if (dineinBtn) dineinBtn.className = 'order-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-white text-gray-500 border-2 border-gray-200';
    if (takeawayBtn) takeawayBtn.className = 'order-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-white text-gray-500 border-2 border-gray-200';

    // Sembunyikan section dine-in dan takeaway
    var dineinSection = document.getElementById('section-dinein');
    var takeawaySection = document.getElementById('section-takeaway');
    if (dineinSection) dineinSection.classList.add('hidden');
    if (takeawaySection) takeawaySection.classList.add('hidden');

    // Tampilkan section fast food
    var ffSection = document.getElementById('section-fastfood');
    if (ffSection) ffSection.classList.remove('hidden');

    // Reset currentTableId agar tidak ada meja aktif
    if (typeof currentTableMode !== 'undefined') {
      // We don't touch currentOrderMode to avoid confusion
    }

    // Render UI Fast Food
    _renderFFUI();
  }

  /**
   * Keluar dari Fast Food Mode (dipanggil saat user klik Dine-in atau Takeaway)
   */
  function exitFastFoodMode() {
    _isFFMode = false;
    _cart = []; // Reset keranjang

    // Sembunyikan section fast food
    var ffSection = document.getElementById('section-fastfood');
    if (ffSection) ffSection.classList.add('hidden');

    // Reset FF mode button style
    var ffBtn = document.getElementById('mode-fastfood');
    if (ffBtn) ffBtn.className = 'order-mode-tab flex-1 py-3 rounded-xl font-bold text-sm bg-white text-orange-500 border-2 border-orange-200 hover:border-orange-400';
  }

  /**
   * Cek apakah sedang dalam fast food mode
   * @returns {boolean}
   */
  function isFFMode() {
    return _isFFMode;
  }

  // ===== UI RENDERING =====

  /**
   * Render seluruh UI Fast Food
   */
  function _renderFFUI() {
    _renderFFCart();
    _renderFFMenu();
    _renderFFQueueDisplay();
  }

  /**
   * Render keranjang Fast Food di panel
   */
  function _renderFFCart() {
    var panel = document.getElementById('ff-cart-panel');
    if (!panel) return;

    var total = getCartTotal();
    var totalItems = getCartItemCount();

    if (_cart.length === 0) {
      panel.innerHTML = '<div class="flex-1 flex flex-col items-center justify-center py-8 text-slate-400">' +
        '<i class="fas fa-fire text-3xl mb-2 text-orange-300"></i>' +
        '<p class="text-sm">Tap menu untuk mulai</p></div>';
      return;
    }

    var itemsHtml = _cart.map(function(item) {
      return '<div class="flex items-center gap-2 bg-orange-50 rounded-xl p-2">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="text-sm font-semibold text-gray-800 truncate">' + item.nama_menu + '</div>' +
          '<div class="text-xs text-orange-500">' + _formatIDR(item.harga) + '</div>' +
        '</div>' +
        '<div class="flex items-center gap-1">' +
          '<button onclick="FastFood.updateQty(\'' + item.id + '\', -1)" class="w-7 h-7 rounded-lg bg-orange-200 flex items-center justify-center text-orange-700 hover:bg-orange-300 transition text-xs"><i class="fas fa-minus"></i></button>' +
          '<span class="w-8 text-center font-bold text-sm text-gray-800">' + item.qty + '</span>' +
          '<button onclick="FastFood.updateQty(\'' + item.id + '\', 1)" class="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center text-white hover:bg-orange-600 transition text-xs"><i class="fas fa-plus"></i></button>' +
        '</div>' +
        '<div class="text-right min-w-[70px]">' +
          '<div class="text-sm font-bold text-gray-800">' + _formatIDR(item.harga * item.qty) + '</div>' +
        '</div>' +
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
          '<span class="text-lg font-bold text-gray-800">' + _formatIDR(total) + '</span>' +
        '</div>' +
        '<button onclick="FastFood.openFFPaymentModal()" class="w-full py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition shadow-md active:scale-[0.98]">' +
          '<i class="fas fa-bolt mr-2"></i>Bayar Sekarang' +
        '</button>' +
      '</div>';
  }

  /**
   * Render menu grid untuk fast food
   */
  function _renderFFMenu() {
    var grid = document.getElementById('ff-menu-grid');
    if (!grid) return;

    if (typeof menuData === 'undefined' || !menuData) {
      grid.innerHTML = '<div class="col-span-full text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p class="text-sm">Memuat menu...</p></div>';
      return;
    }

    // Filter berdasarkan search
    var searchTerm = '';
    var searchInput = document.getElementById('ff-menu-search');
    if (searchInput) searchTerm = searchInput.value.toLowerCase().trim();

    // Filter berdasarkan kategori aktif
    var activeCategory = _ffActiveCategory || 'Semua';
    var filtered = menuData.filter(function(item) {
      var matchSearch = !searchTerm || item.nama_menu.toLowerCase().includes(searchTerm);
      var matchCategory = activeCategory === 'Semua' || item.kategori === activeCategory;
      return matchSearch && matchCategory;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center text-slate-400 py-8"><i class="fas fa-search text-2xl mb-2"></i><p class="text-sm">Menu tidak ditemukan</p></div>';
      return;
    }

    // Cek item yang ada di keranjang
    var cartQtyMap = {};
    _cart.forEach(function(item) {
      cartQtyMap[item.id] = item.qty;
    });

    grid.innerHTML = filtered.map(function(item) {
      var qty = cartQtyMap[item.id] || 0;
      var badgeClass = qty > 0 ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-600';
      var icon = _getCategoryIcon(item.kategori);
      var borderClass = qty > 0 ? 'border-orange-400 ring-1 ring-orange-200' : 'border-gray-200 hover:border-orange-300';
      return '<div class="rounded-xl p-3 border transition cursor-pointer active:scale-95 hover:shadow-md bg-white ' + borderClass + '" onclick="FastFood.addToCart(\'' + item.id + '\')">' +
        '<div class="flex items-start justify-between mb-1">' +
          '<div class="text-2xl"><i class="fas ' + icon + ' text-orange-400"></i></div>' +
          (qty > 0 ? '<span class="text-xs font-bold px-2 py-0.5 rounded-full ' + badgeClass + '">' + qty + '</span>' : '') +
        '</div>' +
        '<div class="text-sm font-semibold text-gray-800 leading-tight mb-1 truncate">' + item.nama_menu + '</div>' +
        '<div class="text-xs font-bold text-orange-600">' + _formatIDR(item.harga) + '</div>' +
      '</div>';
    }).join('');
  }

  // State untuk kategori aktif fast food
  var _ffActiveCategory = 'Semua';

  /**
   * Set kategori menu untuk fast food
   * @param {string} category
   */
  function setCategory(category) {
    _ffActiveCategory = category;

    // Update UI tombol kategori
    var cats = ['Semua', 'Minuman', 'Makanan', 'Lainnya'];
    var catIcons = { 'Semua': 'fa-grip', 'Minuman': 'fa-mug-hot', 'Makanan': 'fa-utensils', 'Lainnya': 'fa-cookie' };
    var catLabels = { 'Semua': 'Semua', 'Minuman': 'Minuman', 'Makanan': 'Makanan', 'Lainnya': 'Lainnya' };

    cats.forEach(function(cat) {
      var btn = document.getElementById('ff-cat-' + cat);
      if (btn) {
        if (cat === category) {
          btn.className = 'cat-btn tab-btn flex-1 py-2 rounded-xl text-xs font-semibold bg-orange-500 text-white';
        } else {
          btn.className = 'cat-btn tab-btn flex-1 py-2 rounded-xl text-xs font-semibold bg-white text-orange-600 border border-orange-200';
        }
      }
    });

    _renderFFMenu();
  }

  /**
   * Render daftar antrian hari ini
   */
  function _renderFFQueueDisplay() {
    var container = document.getElementById('ff-queue-list');
    if (!container) return;

    var key = _getQueueListKey();
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem(key)) || [];
    } catch(e) { /* ignore */ }

    var lastQueue = getLastQueueNumber();
    var nextQueueEl = document.getElementById('ff-next-queue');
    if (nextQueueEl) nextQueueEl.textContent = 'FC-' + String(lastQueue + 1).padStart(3, '0');

    var countEl = document.getElementById('ff-queue-count');
    if (countEl) countEl.textContent = list.length + ' transaksi hari ini';

    if (list.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-400 py-4 text-sm">Belum ada antrian hari ini</div>';
      return;
    }

    // Tampilkan maksimal 20 antrian terakhir
    var displayList = list.slice(0, 20);

    container.innerHTML = displayList.map(function(item, idx) {
      var timeStr = '';
      try {
        var d = new Date(item.time);
        timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      } catch(e) { timeStr = item.time; }

      var isNew = idx === 0;
      var bgClass = isNew ? 'bg-orange-50 border-orange-300' : 'bg-white border-gray-100';
      var numClass = isNew ? 'text-orange-600 font-bold' : 'text-gray-500';

      return '<div class="flex items-center justify-between py-2 px-3 rounded-lg border ' + bgClass + '">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-sm ' + numClass + ' w-16">' + item.queueNumber + '</span>' +
          '<span class="text-xs text-gray-400">' + timeStr + '</span>' +
          (isNew ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">BARU</span>' : '') +
        '</div>' +
        '<div class="text-right">' +
          '<span class="text-xs font-semibold text-gray-700">' + _formatIDR(item.total) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    if (list.length > 20) {
      container.innerHTML += '<div class="text-center text-xs text-slate-400 py-2">+ ' + (list.length - 20) + ' antrian lainnya</div>';
    }
  }

  // ===== HELPER =====
  function _getCategoryIcon(kategori) {
    if (!kategori) return 'fa-utensils';
    var k = kategori.toLowerCase();
    if (k.includes('minuman') || k.includes('drink') || k.includes('jus') || k.includes('kopi') || k.includes('teh') || k.includes('es')) return 'fa-mug-hot';
    if (k.includes('makanan') || k.includes('food') || k.includes('nasi') || k.includes('mie') || k.includes('goreng')) return 'fa-utensils';
    return 'fa-cookie';
  }

  function _showToast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type || 'success');
    } else {
      alert(message);
    }
  }

  function _showConfirm(message, callback) {
    if (typeof customConfirm === 'function') {
      customConfirm(message, callback);
    } else if (confirm) {
      callback(confirm(message));
    }
  }

  // ===== PUBLIC API =====
  return {
    // Mode switching
    openFastFoodMode: openFastFoodMode,
    exitFastFoodMode: exitFastFoodMode,
    isFFMode: isFFMode,

    // Cart
    addToCart: addToCart,
    updateQty: updateQty,
    removeItem: removeItem,
    resetCart: resetCart,
    getCartTotal: getCartTotal,
    getCartItemCount: getCartItemCount,

    // Payment
    openFFPaymentModal: openFFPaymentModal,
    closeFFPaymentModal: closeFFPaymentModal,
    confirmFFPayment: createFastFoodOrder,

    // Queue
    generateQueueNumber: generateQueueNumber,
    getLastQueueNumber: getLastQueueNumber,

    // Order
    createFastFoodOrder: createFastFoodOrder,

    // Menu category
    setCategory: setCategory,

    // Internal (exposed for onclick handlers)
    _updateFFPaymentTotal: _updateFFPaymentTotal,
    _updateFFPayMethodUI: _updateFFPayMethodUI,

    // Refresh menu (for search input oninput)
    refreshMenu: function() { _renderFFMenu(); },
    getActiveCategory: function() { return _ffActiveCategory; },

    // Cart state (read-only, for integration)
    getCart: function() { return _cart.slice(); }
  };

})();


// ============================================================
// INTEGRASI: Patch switchOrderMode untuk mendukung fast_food
// Dipanggil secara otomatis saat file ini dimuat.
// TIDAK mengubah logic existing, hanya menambah fallback.
// ============================================================
(function() {
  // Simpan referensi ke fungsi original
  var _originalSwitchOrderMode = (typeof switchOrderMode === 'function') ? switchOrderMode : null;

  // Override hanya jika fungsi ada
  if (_originalSwitchOrderMode) {
    window.switchOrderMode = function(mode) {
      // Jika mode fast_food, gunakan handler Fast Food
      if (mode === 'fast_food') {
        FastFood.openFastFoodMode();
        return;
      }

      // Exit fast food mode jika sedang aktif
      if (FastFood.isFFMode()) {
        FastFood.exitFastFoodMode();
      }

      // Panggil fungsi original untuk dine-in dan takeaway
      _originalSwitchOrderMode(mode);
    };

    // Patch selectPayMethod agar juga update FF UI
    var _originalSelectPayMethod = (typeof selectPayMethod === 'function') ? selectPayMethod : null;
    if (_originalSelectPayMethod) {
      window.selectPayMethod = function(method) {
        _originalSelectPayMethod(method);
        // Jika sedang di fast food mode, update UI
        if (FastFood.isFFMode()) {
          if (typeof FastFood._updateFFPayMethodUI === 'function') FastFood._updateFFPayMethodUI();
          if (typeof FastFood._updateFFPaymentTotal === 'function') FastFood._updateFFPaymentTotal();
        }
      };
    }
  }

  // Override closePaymentModal untuk restore FF handler
  var _originalClosePaymentModal = (typeof closePaymentModal === 'function') ? closePaymentModal : null;
  if (_originalClosePaymentModal) {
    window.closePaymentModal = function() {
      if (FastFood.isFFMode()) {
        FastFood.closeFFPaymentModal();
        return;
      }
      _originalClosePaymentModal();
    };
  }
})();
