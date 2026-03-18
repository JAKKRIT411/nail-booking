async function checkLogin(){
  const r = await fetch("/api/me",{credentials:"include"})
  if(!r.ok) return

  const d = await r.json()
  document.getElementById("authSection").innerHTML =
    `👤 ${d.user.username} <a href="/logout">Logout</a>`

  loadMyBookings()
}

async function loadServices(){
  const data = await fetch("/api/services").then(r=>r.json())
  const sel = document.getElementById("serviceSelect")

  sel.innerHTML=""

  data.forEach(s=>{
    sel.innerHTML += `<option value="${s._id}">${s.name}</option>`
  })

  if(data[0]) document.getElementById("serviceId").value=data[0]._id

  sel.onchange=()=>{
    document.getElementById("serviceId").value=sel.value
  }
}

async function loadSlots(){
  const data = await fetch("/api/slots").then(r=>r.json())
  const sel = document.getElementById("slotSelect")

  sel.innerHTML=""

  data.filter(s=>s.status==="available").forEach(s=>{
    sel.innerHTML += `<option value="${s._id}">${s.date} ${s.time}</option>`
  })

  if(sel.value) document.getElementById("slotId").value=sel.value

  sel.onchange=()=>{
    document.getElementById("slotId").value=sel.value
  }
}

async function loadMyBookings(){
  const r = await fetch("/api/my-bookings",{credentials:"include"})
  if(!r.ok) return

  const data = await r.json()
  const box = document.getElementById("myBookings")

  box.innerHTML=""

  data.forEach(b=>{
    box.innerHTML += `
      <div>
        ${b.service.name} | ${b.slot.date} ${b.slot.time}
        <button onclick="del('${b._id}')">ลบ</button>
      </div>
    `
  })
}

async function del(id){
  await fetch("/api/delete-my-booking",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id})
  })
  loadMyBookings()
}

window.onload=()=>{
  checkLogin()
  loadServices()
  loadSlots()
}