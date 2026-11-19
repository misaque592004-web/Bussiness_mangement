import { useCallback, useEffect, useMemo, useState } from "react";

const modules = {
  customers: {
    label: "Customers",
    description: "Keep customer contacts and company details in one place.",
    columns: [["name", "Customer"], ["company", "Company"], ["email", "Email"], ["phone", "Phone"]],
    fields: [
      { name: "name", label: "Customer name", required: true },
      { name: "company", label: "Company" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone" },
    ],
  },
  products: {
    label: "Inventory",
    singular: "Product",
    description: "Manage products, prices, and stock on hand.",
    columns: [["name", "Product"], ["sku", "SKU"], ["category", "Category"], ["quantity", "In stock"], ["unit_price", "Unit price", "money"]],
    fields: [
      { name: "name", label: "Product name", required: true },
      { name: "sku", label: "SKU", required: true },
      { name: "category", label: "Category" },
      { name: "quantity", label: "Starting quantity", type: "number", min: 0, required: true },
      { name: "unit_price", label: "Unit price", type: "number", min: 0, step: "0.01", required: true },
    ],
  },
  sales: {
    label: "Sales",
    description: "Record a sale and automatically deduct its units from inventory.",
    columns: [["sale_number", "Sale"], ["customer_name", "Customer"], ["product_name", "Product"], ["quantity", "Units"], ["total_amount", "Total", "money"], ["sold_at", "Date", "date"]],
    fields: [
      { name: "customer_id", label: "Customer", type: "select", source: "customers", required: true },
      { name: "product_id", label: "Product", type: "select", source: "products", required: true },
      { name: "quantity", label: "Quantity", type: "number", min: 1, required: true },
      { name: "sold_at", label: "Sale date", type: "date" },
    ],
  },
  invoices: {
    label: "Invoices",
    description: "Track invoice amounts, customers, due dates, and payment status.",
    columns: [["invoice_number", "Invoice"], ["customer_name", "Customer"], ["amount", "Amount", "money"], ["status", "Status", "status"], ["issued_at", "Issued", "date"], ["due_date", "Due", "date"]],
    fields: [
      { name: "invoice_number", label: "Invoice number", required: true },
      { name: "customer_id", label: "Customer", type: "select", source: "customers", required: true },
      { name: "amount", label: "Amount", type: "number", min: 0.01, step: "0.01", required: true },
      { name: "status", label: "Status", type: "select", defaultValue: "draft", options: [["draft", "Draft"], ["sent", "Sent"], ["paid", "Paid"], ["overdue", "Overdue"]] },
      { name: "issued_at", label: "Issue date", type: "date", required: true },
      { name: "due_date", label: "Due date", type: "date" },
    ],
  },
  expenses: {
    label: "Expenses",
    description: "Log and categorize business expenses.",
    columns: [["description", "Expense"], ["category", "Category"], ["amount", "Amount", "money"], ["incurred_on", "Date", "date"]],
    fields: [
      { name: "description", label: "Description", required: true },
      { name: "category", label: "Category" },
      { name: "amount", label: "Amount", type: "number", min: 0.01, step: "0.01", required: true },
      { name: "incurred_on", label: "Date", type: "date", required: true },
    ],
  },
  employees: {
    label: "Employees",
    description: "Create employee accounts and keep contact details current.",
    columns: [["name", "Name"], ["email", "Email"], ["title", "Job title"], ["phone", "Phone"], ["active", "Access", "active"]],
    fields: [
      { name: "name", label: "Full name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "password", label: "Temporary password (12+ characters)", type: "password", minLength: 12, required: true },
      { name: "title", label: "Job title" },
      { name: "phone", label: "Phone" },
      { name: "hire_date", label: "Hire date", type: "date" },
    ],
    editFields: [
      { name: "name", label: "Full name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "title", label: "Job title" },
      { name: "phone", label: "Phone" },
      { name: "hire_date", label: "Hire date", type: "date" },
      { name: "active", label: "Account access", type: "select", options: [["true", "Active"], ["false", "Disabled"]] },
    ],
  },
  tasks: {
    label: "Tasks",
    description: "Assign work, track due dates, and update progress.",
    columns: [["title", "Task"], ["assigned_to_name", "Assigned to"], ["status", "Status", "status"], ["due_date", "Due date", "date"]],
    fields: [
      { name: "title", label: "Task title", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "assigned_to", label: "Assign to", type: "select", source: "employees", required: true },
      { name: "status", label: "Status", type: "select", defaultValue: "todo", options: [["todo", "To do"], ["in_progress", "In progress"], ["done", "Done"]] },
      { name: "due_date", label: "Due date", type: "date" },
    ],
  },
};

const navOrder = ["customers", "products", "sales", "invoices", "expenses", "employees", "tasks"];
const amountFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function request(path, token, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}

function formatCell(value, kind) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return amountFormat.format(Number(value));
  if (kind === "date") return String(value).slice(0, 10);
  if (kind === "status") {
    return String(value).replaceAll("_", " ");
  }
  if (kind === "active") return value ? "Active" : "Disabled";
  return String(value);
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogin(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">B</div>
        <p className="eyebrow">BUSINESS MANAGEMENT</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage your business workspace.</p>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-width" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
    </main>
  );
}

function Field({ field, value, onChange, options }) {
  const common = {
    id: field.name,
    name: field.name,
    required: field.required,
    value: value ?? "",
    onChange: (event) => onChange(field.name, event.target.value),
    min: field.min,
    step: field.step,
    minLength: field.minLength,
  };
  let control;
  if (field.type === "textarea") {
    control = <textarea {...common} rows="3" />;
  } else if (field.type === "select") {
    const choices = field.options || options || [];
    control = (
      <select {...common}>
        <option value="">Select...</option>
        {choices.map((option) => (
          <option key={option[0]} value={option[0]}>{option[1]}</option>
        ))}
      </select>
    );
  } else {
    control = <input {...common} type={field.type || "text"} />;
  }
  return <label htmlFor={field.name}>{field.label}{control}</label>;
}

function RecordForm({ moduleKey, item, choices, onSave, onClose }) {
  const module = modules[moduleKey];
  const fields = item ? (module.editFields || module.fields) : module.fields;
  const [values, setValues] = useState(() => Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.type === "date" && item?.[field.name]
        ? String(item[field.name]).slice(0, 10)
        : field.name === "active" && item
          ? String(Boolean(item.active))
          : item?.[field.name] ?? field.defaultValue ?? "",
    ]),
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = { ...values };
    for (const [key, value] of Object.entries(payload)) {
      if (value === "" && ["due_date", "hire_date"].includes(key)) payload[key] = null;
    }
    if (moduleKey === "tasks" && payload.description === "") payload.description = "";
    try {
      await onSave(payload);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="record-form" onSubmit={submit}>
        <div className="form-heading">
          <div><p className="eyebrow">{item ? "UPDATE RECORD" : "NEW RECORD"}</p><h2>{item ? "Edit" : "Add"} {module.singular || module.label.slice(0, -1)}</h2></div>
          <button className="icon-button" type="button" aria-label="Close form" onClick={onClose}>×</button>
        </div>
        <div className="form-grid">
          {fields.map((field) => (
            <Field
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={update}
              options={field.source ? choices[field.source] : null}
            />
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving..." : "Save record"}</button>
        </div>
      </form>
    </div>
  );
}

function DashboardHome({ stats, onNavigate, user }) {
  const cards = [
    ["Sales recorded", amountFormat.format(Number(stats?.salesTotal || 0)), "Lifetime sales"],
    ["Products", stats?.productCount ?? 0, `${stats?.inventoryUnits ?? 0} units in stock`],
    ["Low stock", stats?.lowStockCount ?? 0, "Products with 5 or fewer units"],
    ["Customers", stats?.customerCount ?? 0, "Customer records"],
    ["Open tasks", stats?.openTaskCount ?? 0, "Work in progress"],
    ["Invoices due", amountFormat.format(Number(stats?.outstandingInvoiceTotal || 0)), `${stats?.outstandingInvoiceCount ?? 0} unpaid`],
    ...(user.role === "admin" ? [["Expenses", amountFormat.format(Number(stats?.expenseTotal || 0)), "Recorded expenses"]] : []),
  ];

  return (
    <div className="dashboard-content">
      <div className="welcome-panel">
        <div><p className="eyebrow">YOUR BUSINESS AT A GLANCE</p><h2>Good to see you, {user.name.split(" ")[0]}.</h2><p>Here’s what’s happening across your workspace.</p></div>
        <button className="primary-button" onClick={() => onNavigate("sales")} disabled={user.role !== "admin"}>＋ Record a sale</button>
      </div>
      <div className="stat-grid">
        {cards.map(([label, value, caption]) => (
          <article className="stat-card" key={label}>
            <span className="stat-label">{label}</span>
            <strong>{value}</strong>
            <span className="stat-caption">{caption}</span>
          </article>
        ))}
      </div>
      <section className="quick-section">
        <div className="section-title"><div><p className="eyebrow">GET STARTED</p><h3>Quick actions</h3></div></div>
        <div className="quick-grid">
          {["customers", "products", "invoices", "tasks"].map((key) => (
            <button className="quick-card" key={key} onClick={() => onNavigate(key)}>
              <span className="quick-icon">{modules[key].label.slice(0, 1)}</span>
              <span><strong>{modules[key].label}</strong><small>{modules[key].description}</small></span>
              <span className="quick-arrow">↗</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("business-token"));
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(token));
  const [activePage, setActivePage] = useState("home");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [choices, setChoices] = useState({});
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formItem, setFormItem] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const api = useCallback((path, options) => request(path, token, options), [token]);
  const visibleModules = useMemo(
    () => navOrder.filter((key) => user?.role === "admin" || !["expenses", "employees"].includes(key)),
    [user],
  );

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    api("/auth/me")
      .then((result) => { if (active) setUser(result.user); })
      .catch(() => {
        sessionStorage.removeItem("business-token");
        if (active) { setToken(null); setUser(null); }
      })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [api, token]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setPageError("");
    if (activePage === "home") {
      api("/dashboard")
        .then((result) => { if (active) setStats(result); })
        .catch((error) => { if (active) setPageError(error.message); });
      return () => { active = false; };
    }

    setLoading(true);
    Promise.all([
      api(`/${activePage}`),
      activePage === "sales" || activePage === "invoices"
        ? api("/customers").then((items) => items.map((item) => [item.id, item.name]))
        : Promise.resolve([]),
      activePage === "sales" ? api("/products").then((items) => items.map((item) => [item.id, `${item.name} (${item.quantity} in stock)`])) : Promise.resolve([]),
      activePage === "tasks" && user.role === "admin"
        ? api("/employees").then((items) => items.filter((item) => item.active).map((item) => [item.id, item.name]))
        : Promise.resolve([]),
    ])
      .then(([items, customers, products, employees]) => {
        if (!active) return;
        setRows(items);
        setChoices({ customers, products, employees });
      })
      .catch((error) => { if (active) setPageError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activePage, api, user]);

  function handleLogin(result) {
    sessionStorage.setItem("business-token", result.token);
    setToken(result.token);
    setUser(result.user);
    setActivePage("home");
  }

  function handleLogout() {
    sessionStorage.removeItem("business-token");
    setToken(null);
    setUser(null);
    setRows([]);
  }

  async function reloadRows() {
    const items = await api(`/${activePage}`);
    setRows(items);
  }

  async function saveRecord(payload) {
    const endpoint = activePage === "sales" ? "/sales" : `/${activePage}`;
    if (formItem) {
      await api(`${endpoint}/${formItem.id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    }
    setShowForm(false);
    setFormItem(null);
    await reloadRows();
  }

  async function deleteRecord(item) {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    try {
      await api(`/${activePage}/${item.id}`, { method: "DELETE" });
      await reloadRows();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function updateTaskStatus(item, status) {
    try {
      await api(`/tasks/${item.id}`, { method: "PUT", body: JSON.stringify({ status }) });
      await reloadRows();
    } catch (error) {
      setPageError(error.message);
    }
  }

  if (authLoading) return <div className="loading-screen">Loading your workspace...</div>;
  if (!user) return <Login onLogin={handleLogin} />;

  const activeModule = modules[activePage];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActivePage("home")}>
          <span className="brand-mark">B</span><span><strong>BizFlow</strong><small>Business manager</small></span>
        </button>
        <p className="nav-heading">WORKSPACE</p>
        <nav>
          <button className={`nav-item ${activePage === "home" ? "selected" : ""}`} onClick={() => setActivePage("home")}><span className="nav-glyph">⌂</span>Overview</button>
          {visibleModules.map((key) => (
            <button className={`nav-item ${activePage === key ? "selected" : ""}`} key={key} onClick={() => setActivePage(key)}>
              <span className="nav-glyph">{modules[key].label.slice(0, 1)}</span>{modules[key].label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="user-meta"><strong>{user.name}</strong><small>{user.role}</small></span>
          <button className="logout-button" onClick={handleLogout} aria-label="Sign out" title="Sign out">↪</button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div><p className="eyebrow">BUSINESS MANAGEMENT</p><h1>{activeModule?.label || "Overview"}</h1></div>
          <div className="topbar-right"><span className="status-dot" /> Workspace active <span className="topbar-avatar">{user.name.slice(0, 1).toUpperCase()}</span></div>
        </header>
        {activePage === "home" ? (
          <DashboardHome stats={stats} onNavigate={setActivePage} user={user} />
        ) : (
          <section className="module-content">
            <div className="module-heading">
              <div><p className="eyebrow">{user.role === "admin" ? "MANAGE RECORDS" : "YOUR WORKSPACE"}</p><h2>{activeModule.label}</h2><p className="muted">{activeModule.description}</p></div>
              {user.role === "admin" && <button className="primary-button" onClick={() => { setFormItem(null); setShowForm(true); }}>＋ Add {activeModule.singular || activeModule.label.slice(0, -1)}</button>}
            </div>
            {pageError && <p className="inline-error" role="alert">{pageError}</p>}
            <div className="table-card">
              <div className="table-toolbar"><strong>{rows.length} {rows.length === 1 ? "record" : "records"}</strong><button className="refresh-button" onClick={reloadRows} aria-label="Refresh records">↻ Refresh</button></div>
              {loading ? <div className="empty-state">Loading records...</div> : rows.length === 0 ? (
                <div className="empty-state"><span className="empty-mark">＋</span><strong>No {activeModule.label.toLowerCase()} yet</strong><span>Add your first record to get started.</span></div>
              ) : (
                <div className="table-scroll">
                  <table><thead><tr>{activeModule.columns.map(([, label]) => <th key={label}>{label}</th>)}<th className="actions-heading">Actions</th></tr></thead>
                    <tbody>{rows.map((item) => (
                      <tr key={item.id}>
                        {activeModule.columns.map(([key, label, kind]) => (
                          <td key={key}>
                            {key === "status" && activePage === "tasks" ? (
                              <select className="status-select" value={item.status} onChange={(event) => updateTaskStatus(item, event.target.value)} aria-label={`Update status for ${item.title}`}>
                                <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option>
                              </select>
                            ) : <span className={kind === "status" ? `pill pill-${item.status}` : ""}>{formatCell(item[key], kind)}</span>}
                          </td>
                        ))}
                        <td className="row-actions">
                          {user.role === "admin" && activePage !== "sales" && (
                            <>
                              <button className="text-button" onClick={() => { setFormItem(item); setShowForm(true); }}>Edit</button>
                              {!activeModule.editFields && <button className="text-button danger-text" onClick={() => deleteRecord(item)}>Delete</button>}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
      {showForm && <RecordForm moduleKey={activePage} item={formItem} choices={choices} onSave={saveRecord} onClose={() => { setShowForm(false); setFormItem(null); }} />}
    </div>
  );
}
