/* ================= PRODUCT DATA =================
   To add a new part: push one object into the matching
   category array below. Each variant becomes an entry in
   the dropdown; "bands" is optional and only used for the
   live resistor colour-band preview.
==================================================== */
const CATALOG = {
  resistors: {
    label: "Resistors",
    swatch: ["#7a4a2a","#1c2420","#a23b2e"],
    icon: `<svg viewBox="0 0 80 30" fill="none"><path d="M0 15H18L23 4L31 26L39 4L47 26L55 4L60 15H80" stroke="#1C2420" stroke-width="2.5" fill="none"/></svg>`,
    items: [
      {
        name: "Carbon Film Resistor",
        type: "1/4W · axial",
        variants: [
          { label: "100 Ω ± 5%", bands:["#8a5a2b","#1c2420","#8a5a2b","#C9A227"] },
          { label: "220 Ω ± 5%", bands:["#a23b2e","#a23b2e","#8a5a2b","#C9A227"] },
          { label: "1 kΩ ± 5%", bands:["#8a5a2b","#1c2420","#a23b2e","#C9A227"] },
          { label: "4.7 kΩ ± 5%", bands:["#eab308","#a23b2e","#a23b2e","#C9A227"] },
          { label: "10 kΩ ± 5%", bands:["#8a5a2b","#1c2420","#eab308","#C9A227"] },
          { label: "47 kΩ ± 5%", bands:["#eab308","#a23b2e","#eab308","#C9A227"] },
        ]
      },
      {
        name: "Metal Film Resistor",
        type: "1/4W · 1% precision",
        variants: [
          { label: "330 Ω ± 1%", bands:["#a23b2e","#8a5a2b","#1c2420","#a23b2e"] },
          { label: "2.2 kΩ ± 1%", bands:["#a23b2e","#a23b2e","#1c2420","#a23b2e"] },
          { label: "100 kΩ ± 1%", bands:["#8a5a2b","#1c2420","#eab308","#a23b2e"] },
        ]
      },
      {
        name: "Trimmer Potentiometer",
        type: "single-turn · 3296",
        variants: [
          { label: "1 kΩ"},
          { label: "10 kΩ"},
          { label: "100 kΩ"},
        ]
      }
    ]
  },
  capacitors: {
    label: "Capacitors",
    swatch: ["#1F4B44","#2f6f63","#C9A227"],
    icon: `<svg viewBox="0 0 80 30" fill="none"><path d="M0 15H32M48 15H80" stroke="#1C2420" stroke-width="2.5"/><path d="M32 3V27M48 3V27" stroke="#1C2420" stroke-width="3"/></svg>`,
    items: [
      {
        name: "Ceramic Disc Capacitor",
        type: "50V · X7R",
        variants: [
          { label: "100 pF"},
          { label: "1 nF" },
          { label: "10 nF"},
          { label: "100 nF"},
        ]
      },
      {
        name: "Electrolytic Capacitor",
        type: "radial · 25V",
        variants: [
          { label: "1 µF" },
          { label: "10 µF"},
          { label: "100 µF"},
          { label: "1000 µF"},
        ]
      },
      {
        name: "Film Capacitor",
        type: "polyester · 63V",
        variants: [
          { label: "10 nF"},
          { label: "100 nF"},
        ]
      }
    ]
  },
  inductors: {
    label: "Inductors",
    swatch: ["#B5651D","#8C4B14","#eab308"],
    icon: `<svg viewBox="0 0 80 30" fill="none"><path d="M0 15H14" stroke="#1C2420" stroke-width="2.5"/><path d="M14 15q6 -14 13 0t13 0t13 0t13 0" stroke="#1C2420" stroke-width="2.5" fill="none"/><path d="M66 15H80" stroke="#1C2420" stroke-width="2.5"/></svg>`,
    items: [
      {
        name: "Radial Leaded Inductor",
        type: "through-hole",
        variants: [
          { label: "10 µH"},
          { label: "100 µH"},
          { label: "1 mH" },
        ]
      },
      {
        name: "Toroidal Choke",
        type: "power-line filter",
        variants: [
          { label: "1 mH"},
          { label: "10 mH"},
        ]
      }
    ]
  }
};

/* ================= STATE ================= */
let activeCat = "resistors";
let order = []; // {key, name, type, variantLabel, price, qty}

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
  return `
    <div class="card" data-id="${id}">
      <div class="card-icon">${cat.icon}</div>
      <div>
        <p class="card-title">${item.name}</p>
        <div class="card-type">${item.type}</div>
      </div>
      <select class="variant" id="variant-${id}">
        ${item.variants.map((v,vi)=>`<option value="${vi}">${v.label}</option>`).join('')}
      </select>
      ${catKey==='resistors' ? `<div class="band-preview" id="bands-${id}">${bandPreviewHTML(first)}</div>` : ''}
      <div class="spec-row"><span>UNIT PRICE</span><span id="price-${id}"></span></div>
      <div class="card-foot">
        <div class="qty">
          <button data-act="dec">−</button>
          <input type="text" value="1" id="qty-${id}" readonly>
          <button data-act="inc">+</button>
        </div>
        <div class="price"><small>× qty</small></div>
      </div>
      <button class="add-btn" id="add-${id}">Add to order</button>
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
    //priceEl.textContent = `R${v.price.toFixed(2)}`;
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
  const total = order.reduce((s,o)=>s+o.qty,0)
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
renderNav();
renderGrid();
renderDrawer();