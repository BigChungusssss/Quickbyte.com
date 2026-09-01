// Sign-in is now handled by supabaseClient.js + auth-guard.js, which must be
// loaded on the page BEFORE this file:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="supabaseClient.js"></script>
// <script src="auth-guard.js"></script>
// <script src="script.js"></script>
// auth-guard.js's DOMContentLoaded handler redirects to Sign/signin.html and
// sets up the Sign out button; nothing else needed here for auth.

if (!window.storage) {
  window.storage = {
    async get(key) {
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    },
    async set(key, value) {
      localStorage.setItem(key, value);
    },
    async delete(key) {
      localStorage.removeItem(key);
    }
  };
}

/* ================= CONFIG ================= */


// Paste the "Publish to web" CSV link from the client's Google Sheet here.
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRtBKzhJV6QX8i1cK_x6ltzZfo9J5wDxdiRCpmCk-AvsbG7EPAP1o8B8Y1JgE_6P8-Y_Knhtk1NZxYy/pub?gid=1974837864&single=true&output=csv";
const API_BASE_URL = "https://quickbyte-com-food-ordering-website.onrender.com"; 
/* ================= STATE ================= */
let CATALOG = {}; // Rebuilt from sheet rows: { category: { label, color, icon, items:[{name,type,variants:[...]}] } }
let activeCat = "";
let order = []; // {key, name, variantLabel, qty}

/* ================= AUTO ICON (no code changes needed for new categories) ================= */
// Generates a simple colored circle with the category's initial letter.
function autoIcon(label, color){
  const letter = (label || "?").trim().charAt(0).toUpperCase();
  return `<svg viewBox="0 0 80 30" fill="none">
    <circle cx="15" cy="15" r="12" fill="${color}" />
    <text x="15" y="20" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#fff">${letter}</text>
  </svg>`;
}

/* ================= BUILD CATALOG FROM SHEET ROWS ================= */
function buildCatalogFromRows(rows) {
  const catalog = {};

  rows.forEach(row => {
    const catKey = (row.category || "").trim();
    if (!catKey) return; // skip blank rows

    const catLabel = (row.category_label || catKey).trim();
    const catColor = (row.category_color || "#555555").trim();

    const itemName = (row.item_name || "").trim();
    const itemType = (row.item_type || "").trim();
    const variantLabel = (row.variant_label || "").trim();
    const inStock = String(row.inStock).trim().toUpperCase() !== "FALSE";
    const bandsRaw = (row.bands || "").trim();
    const bands = bandsRaw ? bandsRaw.split(",").map(b => b.trim()).filter(Boolean) : null;

    if (!catalog[catKey]) {
      catalog[catKey] = {
        label: catLabel,
        color: catColor,
        icon: autoIcon(catLabel, catColor),
        items: []
      };
    }

    let item = catalog[catKey].items.find(it => it.name === itemName);
    if (!item) {
      item = { name: itemName, type: itemType, variants: [] };
      catalog[catKey].items.push(item);
    }

    item.variants.push({
      label: variantLabel,
      inStock,
      ...(bands ? { bands } : {})
    });
  });

  return catalog;
}

/* ================= FETCH ================= */
async function loadCatalog() {
  try {
    const response = await fetch(SHEET_CSV_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const csvText = await response.text();

    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    CATALOG = buildCatalogFromRows(parsed.data);

    activeCat = Object.keys(CATALOG)[0] || "";
    initApp();
  } catch (error) {
    console.error("Failed to load component catalog:", error);
    const main = document.getElementById('main');
    if (main) main.innerHTML = `<p class="error">Failed to load catalog data. Please check connection.</p>`;
  }
}


async function saveCart(){
  try{ await window.storage.set('cart', JSON.stringify(order), false); }catch(e){}
}

async function loadCart(){
  try{
    const res = await window.storage.get('cart', false);
    order = res ? JSON.parse(res.value) : [];
  }catch(e){ order = []; }
}
/* ================= RENDER: CATEGORY NAV ================= */
const catNav = document.getElementById('catNav');
function renderNav(){
  catNav.innerHTML = Object.entries(CATALOG).map(([key, cat]) => `
    <button class="cat-tab ${key===activeCat?'active':''}" data-cat="${key}" style="--cat-color:${cat.color}">
      <span class="card-icon" style="width:24px;display:inline-block;vertical-align:middle;margin-right:6px;">${cat.icon}</span>
      ${cat.label}
    </button>
  `).join('');
  catNav.querySelectorAll('.cat-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{ activeCat = btn.dataset.cat; renderNav(); renderGrid(); });
  });
}

/* ================= RENDER: PRODUCT GRID ================= */
const main = document.getElementById('main');
function renderGrid(){
  const cat = CATALOG[activeCat];
  if (!cat) return;

  main.innerHTML = `
    <div class="section-label">${cat.label}</div>
    <div class="grid">
      ${cat.items.map((item, i) => cardHTML(activeCat, i, item)).join('')}
    </div>
  `;
  cat.items.forEach((item, i) => wireCard(activeCat, i, item));
}

function cardHTML(catKey, i, item){
  const cat = CATALOG[catKey];
  const id = `${catKey}-${i}`;
  const first = item.variants[0];
  const isAvailable = first.inStock !== false;
  return `
    <div class="card ${!isAvailable ? 'out-of-stock' : ''}" data-id="${id}">
      <div class="card-icon">${cat.icon}</div>
      <div>
        <p class="card-title">${item.name}</p>
        <div class="card-type">${item.type}</div>
      </div>
      <select class="variant" id="variant-${id}">
        ${item.variants.map((v,vi)=>`<option value="${vi}" ${v.inStock == false ? 'disabled' : ''}>${v.label} ${v.inStock == false ? 'OutofStock' : ''}</option>`).join('')}
      </select>
      ${item.variants.some(v=>v.bands) ? `<div class="band-preview" id="bands-${id}">${bandPreviewHTML(first)}</div>` : ''}
      <div class="card-foot">
        <div class="qty">
          <button data-act="dec">−</button>
          <input type="text" value="1" id="qty-${id}" readonly>
          <button data-act="inc">+</button>
        </div>
      </div>
      <button class="add-btn" id="add-${id}">Add to Order</button>
    </div>
  `;
}

function bandPreviewHTML(variant){
  if(!variant.bands) return `<div class="body"></div>`;
  const bands = variant.bands.map(c=>`<span class="band" style="background:${c}"></span>`).join('');
  return `<span class="lead"></span><div class="body">${bands}</div><span class="lead"></span>`;
}

function wireCard(catKey, i, item){
  const id = `${catKey}-${i}`;
  const select = document.getElementById(`variant-${id}`);
  const qtyEl = document.getElementById(`qty-${id}`);
  const bandsEl = document.getElementById(`bands-${id}`);
  const addBtn = document.getElementById(`add-${id}`);
  const card = document.querySelector(`[data-id="${id}"]`);

  function currentVariant(){ return item.variants[select.value]; }

  select.addEventListener('change', ()=>{
    const v = currentVariant();
    if(bandsEl) bandsEl.innerHTML = bandPreviewHTML(v);
  });

  card.querySelectorAll('.qty button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      let n = parseInt(qtyEl.value,10) || 1;
      n = btn.dataset.act === 'inc' ? n+1 : Math.max(1, n-1);
      qtyEl.value = n;
    });
  });

  addBtn.addEventListener('click', ()=>{
    const v = currentVariant();
    const qty = parseInt(qtyEl.value,10) || 1;
    const key = `${id}-${select.value}`;
    const existing = order.find(o=>o.key===key);
    if(existing){ existing.qty += qty; }
    else{
      order.push({ key, name:item.name, variantLabel:v.label, qty });
    }
    addBtn.textContent = "Added ✓";
    addBtn.classList.add('added');
    setTimeout(()=>{ addBtn.textContent="Add to order"; addBtn.classList.remove('added'); }, 900);
    renderDrawer();
    saveCart();
  });
}

/* ================= ORDER DRAWER ================= */
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
const drawerItems = document.getElementById('drawerItems');
const drawerTotal = document.getElementById('drawerTotal');
const cartCount = document.getElementById('cartCount');

function renderDrawer(){
  cartCount.textContent = order.reduce((s,o)=>s+o.qty,0);
  if(order.length===0){
    drawerItems.innerHTML = `<div class="drawer-empty">Nothing added yet.<br>Pick a value and hit "Add to order".</div>`;
    drawerTotal.textContent = `0 items`;
    return;
  }
  drawerItems.innerHTML = order.map(o=>`
    <div class="drawer-item">
      <div>
        <div class="di-name">${o.name}</div>
        <div class="di-meta">${o.variantLabel} · qty ${o.qty}</div>
      </div>
      <div style="text-align:right">
        <div></div>
        <button class="di-remove" data-key="${o.key}">remove</button>
      </div>
    </div>
  `).join('');
drawerItems.querySelectorAll('.di-remove').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      order = order.filter(o=>o.key!==btn.dataset.key);
      renderDrawer();
      saveCart();   // ← added this line
    });
  });
  const total = order.reduce((s,o)=>s+o.qty,0);
  drawerTotal.textContent = `${total} items`;
}

document.getElementById('openDrawer').addEventListener('click', ()=>{ drawer.classList.add('open'); scrim.classList.add('show'); });
document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }

document.getElementById('checkoutBtn').addEventListener('click', async ()=>{
  const errorEl = document.getElementById('checkoutError');
  if(errorEl) errorEl.textContent = '';
 
  if(order.length === 0){
    if(errorEl) errorEl.textContent = 'Your cart is empty.';
    return;
  }
 
  const emailInput = document.getElementById('customerEmail');
  const customerEmail = emailInput ? emailInput.value.trim() : '';
  if(!customerEmail || !customerEmail.includes('@')){
    if(errorEl) errorEl.textContent = 'Enter a valid email first.';
    if(emailInput) emailInput.focus();
    return;
  }
 
  const checkoutBtn = document.getElementById('checkoutBtn');
  checkoutBtn.disabled = true;
  const originalLabel = checkoutBtn.textContent;
  checkoutBtn.textContent = 'Sending…';
 
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`${API_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ customerEmail, items: order }),
    });
 
    if(!res.ok){
      const body = await res.json().catch(()=>({}));
      throw new Error(body.error || `Server responded ${res.status}`);
    }
 
    const data = await res.json();
 
    order = [];
    await saveCart();
    renderDrawer();
    closeDrawer();
    if(emailInput) emailInput.value = '';
    alert(`Order sent! Box ${data.boxNumber} has been assigned. You'll get an email with your pickup code once the supplier marks it ready.`);
  }catch(err){
    console.error('Failed to send order:', err);
    if(errorEl) errorEl.textContent = 'Could not send the order — check your connection and try again.';
  }finally{
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = originalLabel;
  }
});
function ensureCheckoutForm(){
  if(document.getElementById('customerEmail')) return; // already added
  const checkoutBtn = document.getElementById('checkoutBtn');
  if(!checkoutBtn) return;
  checkoutBtn.insertAdjacentHTML('beforebegin', `
    <div class="checkout-email-row" style="margin:10px 0;">
      <label for="customerEmail" style="display:block;font-size:12px;margin-bottom:4px;">
        Your email (we'll send your pickup code here)
      </label>
      <input type="email" id="customerEmail" placeholder="you@example.com"
             style="width:100%;padding:8px;box-sizing:border-box;">
      <div id="checkoutError" style="color:#c0392b;font-size:12px;margin-top:4px;"></div>
    </div>
  `);
}

/* ================= INIT ================= */
function initApp() {
  
  renderNav();
  renderGrid();
  renderDrawer();
  ensureCheckoutForm();
  loadCart().then(renderDrawer);
}

loadCatalog();