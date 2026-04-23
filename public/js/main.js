async function checkLogin(){
  try{
    const r = await fetch("/api/me",{credentials:"include"})

    if(!r.ok){
      document.getElementById("authSection").innerHTML =
        `<a href="/login.html">Login</a>`
      return
    }

    const d = await r.json()

    document.getElementById("authSection").innerHTML =
      `👤 ${d.user.username} <a href="/logout">Logout</a>`

    loadMyBookings()

  }catch(e){
    console.error(e)
  }
}

async function loadServices(){
  const data = await fetch("/api/services").then(r=>r.json())
  const sel = document.getElementById("serviceSelect")

  sel.innerHTML=""

  data.forEach(s=>{
    sel.innerHTML += `<option value="${s._id}">💅 ${s.name} (${s.price}฿)</option>`
  })

  if(data[0]) document.getElementById("serviceId").value = data[0]._id

  sel.onchange=()=>{
    document.getElementById("serviceId").value = sel.value
  }
}

async function loadSlots(){
  const data = await fetch("/api/slots").then(r=>r.json())
  const sel = document.getElementById("slotSelect")

  sel.innerHTML=""

  const available = data.filter(s=>s.status==="available")

  available.forEach(s=>{
    sel.innerHTML += `<option value="${s._id}">${s.date} ${s.time}</option>`
  })

  // BUG FIX: set slotId on initial load (was only set on change, causing empty slotId on submit)
  if(available.length > 0){
    document.getElementById("slotId").value = available[0]._id
  } else {
    document.getElementById("slotId").value = ""
  }

  sel.onchange=()=>{
    document.getElementById("slotId").value = sel.value
  }
}

async function loadMyBookings(){
  const r = await fetch("/api/my-bookings",{credentials:"include"})
  if(!r.ok) return

  const data = await r.json()
  const box = document.getElementById("myBookings")

  box.innerHTML=""

  if(data.length === 0){
    box.innerHTML = "<p>ยังไม่มีการจอง</p>"
    return
  }

  data.forEach(b=>{
    box.innerHTML += `
      <div style="border:1px solid #eee;padding:10px;margin-bottom:10px;border-radius:8px;">
        💅 ${b.service} (${b.price}฿)<br>
        📅 ${b.date} ⏰ ${b.time}<br>
        📌 สถานะ: <strong>${b.status}</strong>
        ${b.reason ? `<br>❌ เหตุผล: ${b.reason}` : ""}
        <br><br>
        ${b.status === "pending" ? `<button onclick="del('${b.id}')">ยกเลิกการจอง</button>` : ""}
      </div>
    `
  })
}

async function del(id){
  if(!confirm("ต้องการยกเลิกการจองนี้?")) return
  await fetch("/api/delete-my-booking",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id})
  })
  loadMyBookings()
  loadSlots()
}

window.onload=()=>{
  checkLogin()
  loadServices()
  loadSlots()
}
