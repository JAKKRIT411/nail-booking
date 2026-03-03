async function load() {
  const services = await fetch("/api/services").then(r => r.json());
  const times = await fetch("/api/times").then(r => r.json());

  const serviceSelect = document.getElementById("service");
  const timeSelect = document.getElementById("time");

  services.forEach(s => {
    serviceSelect.innerHTML += `<option value="${s.name}">
      ${s.name} - ${s.price}฿
    </option>`;
  });

  times.forEach(t => {
    timeSelect.innerHTML += `<option value="${t.time}">
      ${t.time}
    </option>`;
  });
}

load();