async function load() {

  const services = await fetch("/api/services").then(r => r.json());
  const slots = await fetch("/api/slots").then(r => r.json());

  const serviceSelect = document.getElementById("service");
  const timeSelect = document.getElementById("time");

  serviceSelect.innerHTML = "";
  timeSelect.innerHTML = "";

  // SERVICES
  services.forEach(s => {
    serviceSelect.innerHTML += `
      <option value="${s._id}">
        ${s.name} - ${s.price}฿
      </option>`;
  });

  // SLOTS
  slots
    .filter(s => s.status === "available")
    .forEach(s => {
      timeSelect.innerHTML += `
        <option value="${s._id}">
          ${s.date} ${s.time}
        </option>`;
    });

  // set ค่า default
  if (services.length > 0)
    document.getElementById("serviceId").value = services[0]._id;

  if (slots.length > 0)
    document.getElementById("slotId").value = slots[0]._id;

  // sync select → hidden input
  serviceSelect.onchange = () => {
    document.getElementById("serviceId").value = serviceSelect.value;
  };

  timeSelect.onchange = () => {
    document.getElementById("slotId").value = timeSelect.value;
  };
}

load();