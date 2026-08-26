const cardInner = document.getElementById('cardInner');
const heading = document.getElementById('heading');
const hint = document.getElementById('hint');
const toastEl = document.getElementById('toast');
const clockEl = document.getElementById('clock');

// Add this snippet at the top of your JavaScript file
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

const DEGREES = ["BSc","BA","BCom","BEng","LLB","MSc","MA","MBA","PhD","Other"];

function tick(){
  clockEl.textContent = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
tick(); setInterval(tick, 30000);

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=> toastEl.classList.remove('show'), 2200);
}

async function getActive(){
  try{
    const res = await window.storage.get('active-session', false);
    return res ? JSON.parse(res.value) : null;
  }catch(e){ return null; }
}
async function setActive(data){
  await window.storage.set('active-session', JSON.stringify(data), false);
}
async function clearActive(){
  try{ await window.storage.delete('active-session', false); }catch(e){}
}
async function saveStudentRecord(data){
  try{
    await window.storage.set('student:' + data.studentNumber, JSON.stringify(data), false);
  }catch(e){ console.error('save failed', e); }
}
async function deleteStudentRecord(number){
  try{ await window.storage.delete('student:' + number, false); }catch(e){}
}

function renderForm(prefill){
  prefill = prefill || {};
  heading.textContent = prefill.studentNumber ? 'Edit your details' : 'Course sign-in';
  hint.textContent = 'Your details are saved so you can sign back in later. Nothing here decides where you land yet — that comes next.';

  cardInner.innerHTML = `
    <label for="courseCode">Course code</label>
    <input id="courseCode" placeholder="e.g. COMS3011" autocomplete="off" value="${esc(prefill.courseCode||'')}">

    <label for="name">Full name</label>
    <input id="name" placeholder="e.g. Naledi Khumalo" autocomplete="off" value="${esc(prefill.name||'')}">

    <div class="row2">
      <div>
        <label for="studentNumber">Student number</label>
        <input id="studentNumber" placeholder="e.g. 2145678" autocomplete="off" value="${esc(prefill.studentNumber||'')}">
      </div>
      <div>
        <label for="degree">Degree</label>
        <select id="degree">
          ${DEGREES.map(d => `<option value="${d}" ${prefill.degree===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
    </div>

    <label for="groupNumber">Group number</label>
    <input id="groupNumber" placeholder="e.g. Group 4" autocomplete="off" value="${esc(prefill.groupNumber||'')}">

    <div class="err" id="err"></div>
    <button class="btn btn-primary" id="submitBtn">${prefill.studentNumber ? 'Save changes' : 'Sign in'}</button>
  `;

  document.getElementById('submitBtn').addEventListener('click', onSubmit);
}

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function onSubmit(){
  const courseCode = document.getElementById('courseCode').value.trim();
  const name = document.getElementById('name').value.trim();
  const studentNumber = document.getElementById('studentNumber').value.trim();
  const degree = document.getElementById('degree').value;
    const groupNumber = document.getElementById('groupNumber').value.trim();
  const errEl = document.getElementById('err');

  if(!courseCode || !name || !studentNumber){
    errEl.textContent = 'Fill in course code, name, and student number';
    return;
  }
  errEl.textContent = '';

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const record = { courseCode, name, studentNumber, groupNumber, degree, signedInAt: new Date().toISOString() };

  try{
    await saveStudentRecord(record);
    await setActive(record);
    toast('Signed in');
    renderSignedIn(record);
  }catch(e){
    errEl.textContent = 'Could not save — try again.';
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

function renderSignedIn(data){
  heading.textContent = 'Signed in';
  hint.textContent = 'Sign out keeps your details saved for next time. Delete removes them completely.';

  cardInner.innerHTML = `
    <span class="stamp"><span class="dot"></span>Enrolled</span>
    <div style="margin-top:18px;">
      <div class="field"><span class="k">Course code</span><span class="v">${esc(data.courseCode)}</span></div>
      <div class="field"><span class="k">Name</span><span class="v">${esc(data.name)}</span></div>
      <div class="field"><span class="k">Student number</span><span class="v">${esc(data.studentNumber)}</span></div>
      <div class="field"><span class="k">Degree</span><span class="v">${esc(data.degree)}</span></div>
      </div>
    <div class="actions">
      <button class="btn btn-ghost" id="btnSignOut">Sign out</button>
      <button class="btn btn-ghost" id="btnReset">Reset</button>
      <button class="btn btn-danger" id="btnDelete">Delete</button>
    </div>
  `;

  document.getElementById('btnSignOut').addEventListener('click', async ()=>{
    await clearActive();
    toast('Signed out — your details are still saved');
    renderForm();
  });

  document.getElementById('btnReset').addEventListener('click', ()=>{
    renderForm(data);
  });

  document.getElementById('btnDelete').addEventListener('click', async ()=>{
    if(!confirm('Delete your saved details? This cannot be undone.')) return;
    await deleteStudentRecord(data.studentNumber);
    await clearActive();
    toast('Details deleted');
    renderForm();
  });
}

(async function init(){
  const active = await getActive();
  if(active){
    renderSignedIn(active);
  }else{
    renderForm();
  }
})();