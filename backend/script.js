/* ================= STATE & DATA FETCH ================= */
let CATALOG = {}; // Holds fetched JSON data
let activeCat = "resistors";
let order = []; // {key, name, type, variantLabel, price, qty}

// Asynchronously load the catalog data from catalog.json
async function loadCatalog() {
  try {
    const response = await fetch('./catalog.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    CATALOG = await response.json();

    // Set default active category to the first key in the JSON object
    activeCat = Object.keys(CATALOG)[0] || "resistors";

    // Initialize UI after data is ready
    initApp();
  } catch (error) {
    console.error("Failed to load component catalog:", error);
    const main = document.getElementById('main');
    if (main) {
      main.innerHTML = `<p class="error">Failed to load catalog data. Please check connection.</p>`;
    }
  }
}

/* ================= RENDER: CATEGORY NAV ================= */
const catNav = document.getElementById('catNav');
function renderNav(){
  catNav.innerHTML = Object.entries(CATALOG).map(([key, cat]) => `
    <button class="cat-tab ${key===activeCat?'active':''}" data-cat="${key}">
      <span class="band-strip">${cat.swatch.map(c=>`<span class="band" style="background:${c}"></span>`).join('')}</span>
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
      ${catKey==='resistors' ? `<div class="band-preview" id="bands-${id}">${bandPreviewHTML(first)}</div>` : ''}
      <div class="spec-row"><span></span><span id="price-${id}"></span></div>
      <div class="card-foot">
        <div class="qty">
          <button data-act="dec">−</button>
          <input type="text" value="1" id="qty-${id}" readonly>
          <button data-act="inc">+</button>
        </div>
        <div class="price"><small>× qty</small></div>
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
  const priceEl = document.getElementById(`price-${id}`);
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
    });
  });
  const total = order.reduce((s,o)=>s+o.qty,0);

  drawerTotal.textContent = `${total} items`;
}

document.getElementById('openDrawer').addEventListener('click', ()=>{ drawer.classList.add('open'); scrim.classList.add('show'); });
document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }

document.getElementById('checkoutBtn').addEventListener('click', ()=>{
  alert('Layout preview only — emailing the order to the supplier is the next step.');
});

/* ================= INIT ================= */
function initApp() {
  renderNav();
  renderGrid();
  renderDrawer();
}

// Start loading data on load
loadCatalog();