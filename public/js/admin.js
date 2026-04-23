/* admin.js - frontend script for admin panel */

function blurEmail(email){
  if(!email) return ""
  const [name, domain] = email.split("@")
  return name.slice(0,2) + "***@" + domain
}

/* AUTH */

async function checkAuth(){
  const res = await fetch("/api/me",{credentials:"include"})

  if(!res.ok){
    location="/login.html"
    return
  }

  const data = await res.json()

  if(!data.user || data.user.role!=="admin"){
    location="/login.html"
    return
  }

  document.getElementById("adminName").innerText = data.user.username
}

function logout(){
  location="/logout"
}

/* MENU */

function show(id){
  document.querySelectorAll(".section")
    .forEach(s=>s.classList.remove("active"))
  document.getElementById(id)
    .classList.add("active")
}

/* DASHBOARD */

async function loadRevenue(){
  const res = await fetch("/admin/revenue",{credentials:"include"})
  const data = await res.json()

  const labels = Object.keys(data)
  const values = Object.values(data)

  const total = values.reduce((a,b)=>a+b,0)

  document.getElementById("totalRevenue").innerText = total + " บาท"

  new Chart(document.getElementById("chart"),{
    type:"bar",
    data:{
      labels,
      datasets:[{
        label:"Revenue",
        data:values,
        backgroundColor:"#6366f1"
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false } }
    }
  })
}

/* CALENDAR */

async function loadCalendar(){
  const res = await fetch("/admin/all-slots",{credentials:"include"})
  const slots = await res.json()

  const grid = document.getElementById("calendarGrid")
  grid.innerHTML=""

  if(slots.length === 0){
    grid.innerHTML = "<p>ยังไม่มีคิว</p>"
    return
  }

  slots.forEach(s=>{
    grid.innerHTML += `
      <div class="card">
        <strong>${s.date}</strong><br>
        <div class="slot">
          ⏰ ${s.time}<br>
          <span class="badge ${s.status==="available"?"green":"orange"}">
            ${s.status}
          </span>
        </div>
        <button onclick="deleteSlot('${s._id}')"
          ${s.status==="booked"?"disabled":""}>Delete</button>
      </div>
    `
  })
}

async function addSlot(){
  const date = document.getElementById("slotDate").value
  const time = document.getElementById("slotTime").value

  if(!date || !time) return alert("กรอกวันที่และเวลา")

  const res = await fetch("/admin/add-slot",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"include",
    body:JSON.stringify({date,time})
  })

  const data = await res.json()
  if(data.error) return alert(data.error)

  loadCalendar()
}

async function deleteSlot(id){
  if(!confirm("ลบ slot นี้?")) return

  await fetch("/admin/delete-slot",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"include",
    body:JSON.stringify({id})
  })

  loadCalendar()
}

/* BOOKINGS */

async function loadBookings(){
  const res = await fetch("/admin/bookings",{credentials:"include"})
  const data = await res.json()

  const bookingList = document.getElementById("bookingList")
  bookingList.innerHTML=""

  document.getElementById("totalBookings").innerText = data.length

  data.forEach(b=>{
    bookingList.innerHTML += `
      <div class="card">
        👤 ${b.username}<br>
        📧 ${blurEmail(b.email)}
        <br><br>
        💅 ${b.service?.name} (${b.service?.price}฿)<br>
        📅 ${b.slot?.date} ⏰ ${b.slot?.time}
        ${b.slip ? `<br><img src="${b.slip}" onclick="window.open('${b.slip}')">` : ""}
        <br><br>
        <span class="badge ${
          b.status==="approved"?"green":
          b.status==="rejected"?"gray":"orange"
        }">
          ${b.status}
        </span>
        <br><br>
        ${b.status==="pending"?`
          <button onclick="approve('${b.id}')">Approve</button>
          <button onclick="reject('${b.id}')">Reject</button>
        `:""}
      </div>
    `
  })
}

async function approve(id){
  await fetch("/admin/update-booking",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"include",
    body:JSON.stringify({id,status:"approved"})
  })

  loadBookings()
}

async function reject(id){
  const reason = prompt("เหตุผลในการปฏิเสธ")

  if(!reason){
    alert("กรุณาใส่เหตุผล")
    return
  }

  await fetch("/admin/update-booking",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"include",
    body:JSON.stringify({id, status:"rejected", reason})
  })

  loadBookings()
  loadCalendar()
}

/* SERVICES */

async function loadServices(){
  const res = await fetch("/api/services")
  const data = await res.json()

  const serviceList = document.getElementById("serviceList")
  serviceList.innerHTML=""

  data.forEach(s=>{
    serviceList.innerHTML += `
      <div class="card">
        ${s.name} - ${s.price} บาท
        <button onclick="deleteService('${s._id}')">Delete</button>
      </div>
    `
  })
}

async function addService(){
  const name = document.getElementById("newName").value
  const price = document.getElementById("newPrice").value

  if(!name || !price) return alert("กรอกชื่อและราคา")

  await fetch("/admin/add-service",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"include",
    body:JSON.stringify({name, price})
  })

  document.getElementById("newName").value=""
  document.getElementById("newPrice").value=""

  loadServices()
}

async function deleteService(id){
  const res = await fetch("/admin/delete-service",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    credentials:"include",
    body:JSON.stringify({id})
  })

  const data = await res.json()
  if(data.error) return alert(data.error)

  loadServices()
}

/* START */

checkAuth()
loadRevenue()
loadCalendar()
loadBookings()
loadServices()
