const express = require("express");

const app = express();
const PORT = process.env.PORT || 4000;

const todos = [
  { id: 1, text: "Write the quarterly report", done: false },
  { id: 2, text: "Review pull requests", done: true },
  { id: 3, text: "Plan the team offsite", done: false },
];

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 20px; color: #0f172a; }
    h1 { font-size: 28px; }
    nav a { color: #2563eb; text-decoration: none; font-weight: 600; }
    ul { list-style: none; padding: 0; }
    li { padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; }
    li.done { color: #94a3b8; text-decoration: line-through; }
    button { background: #2563eb; color: #fff; border: none; padding: 12px 20px; border-radius: 8px; font-size: 16px; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    #export-banner { display: none; margin-top: 16px; padding: 12px 16px; background: #dcfce7; color: #166534; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(
    layout(
      "Demo Todo App",
      `<h1>Demo Todo App</h1>
       <p>A tiny fixture app for testing demo-gen.</p>
       <nav><a href="/todos">Go to Todos</a></nav>`
    )
  );
});

app.get("/todos", (req, res) => {
  const items = todos
    .map((t) => `<li class="${t.done ? "done" : ""}">${t.text}</li>`)
    .join("\n");
  res.send(
    layout(
      "Your Todos",
      `<h1>Your Todos</h1>
       <ul>${items}</ul>
       <button id="export-btn" type="button">Export to CSV</button>
       <div id="export-banner">Exported!</div>
       <script>
         document.getElementById('export-btn').addEventListener('click', async () => {
           const res = await fetch('/todos/export.csv');
           const blob = await res.blob();
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url;
           a.download = 'todos.csv';
           document.body.appendChild(a);
           a.click();
           a.remove();
           URL.revokeObjectURL(url);
           document.getElementById('export-banner').style.display = 'block';
         });
       </script>`
    )
  );
});

app.get("/todos/export.csv", (req, res) => {
  const header = "id,text,done";
  const rows = todos.map((t) => `${t.id},"${t.text.replace(/"/g, '""')}",${t.done}`);
  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=todos.csv");
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`Sample app listening on http://localhost:${PORT}`);
});
