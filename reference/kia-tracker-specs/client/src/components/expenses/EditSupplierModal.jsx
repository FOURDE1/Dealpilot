import { useEffect, useState } from "react";
import { X, Save } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const PROVINCES_CA = ["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"];
const STATES_US    = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

function formatPhone(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0,3)}) ${d.slice(3)}`;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
}

const PROVINCE_ALIASES = {
  ONTARIO: "ON", QUEBEC: "QC", "QUÉBEC": "QC",
  ALBERTA: "AB", "BRITISH COLUMBIA": "BC", MANITOBA: "MB",
  "NEW BRUNSWICK": "NB", "NEWFOUNDLAND AND LABRADOR": "NL", "NOVA SCOTIA": "NS",
  "NORTHWEST TERRITORIES": "NT", NUNAVUT: "NU",
  "PRINCE EDWARD ISLAND": "PE", SASKATCHEWAN: "SK", YUKON: "YT",
};

function normalizeProvince(v) {
  if (!v) return "";
  const up = String(v).trim().toUpperCase();
  return PROVINCE_ALIASES[up] || up;
}

const EMPTY = {
  name: "", category: "", address: "", city: "", postal_code: "",
  country: "CANADA", province: "", phone: "", fax: "",
  dealer_number: "", rin_number: "", tax_number: "", pst_number: "",
  email: "", driver_license: "", driver_license_expiry: "",
  default_expense_type: "", default_account: "",
  posted: false, tax_exempt: false, memo: "",
};

export default function EditSupplierModal({
  supplier,
  expenseCategories = [],
  onClose,
  onSaved,
  authToken,
}) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (supplier) {
      setForm({
        ...EMPTY,
        ...supplier,
        province: normalizeProvince(supplier.province),
      });
    } else {
      setForm(EMPTY);
    }
  }, [supplier]);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e?.target?.type === "checkbox" ? e.target.checked : e.target.value }));

  const provinceOptions =
    form.country === "USA" ? STATES_US : PROVINCES_CA;

  async function save() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const url    = supplier?.id ? `${API_URL}/suppliers/${supplier.id}` : `${API_URL}/suppliers`;
      const method = supplier?.id ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json().catch(()=>({})))?.error || `HTTP ${r.status}`);
      const saved = await r.json();
      onSaved?.(saved);
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl mt-10">
        <div className="flex items-center justify-between bg-amber-300 px-5 py-3 rounded-t-lg">
          <h2 className="text-lg font-semibold text-gray-900">
            {supplier?.id ? "Edit Supplier" : "New Supplier"}
          </h2>
          <button onClick={onClose} className="text-gray-700 hover:text-gray-900">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 text-sm">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
              {error}
            </div>
          )}

          <Field label="Name">
            <input className={input} value={form.name} onChange={set("name")} />
          </Field>

          <Field label="Category" labelBlue>
            <input
              className={input}
              list="supplierCategoryOptions"
              value={form.category || ""}
              onChange={set("category")}
              placeholder="ONE TIME VENDOR, MECHANICAL, BODYWORK…"
            />
            <datalist id="supplierCategoryOptions">
              <option value="ONE TIME VENDOR" />
              <option value="MECHANICAL" />
              <option value="BODYWORK" />
              <option value="DETAIL" />
              <option value="TRANSPORT" />
              <option value="PARTS" />
              <option value="OTHER" />
            </datalist>
          </Field>

          <Field label="Address">
            <input className={input} value={form.address || ""} onChange={set("address")} />
          </Field>

          <Row>
            <Field label="City" wide>
              <input className={input} value={form.city || ""} onChange={set("city")} />
            </Field>
            <Field label="Postal">
              <input className={input} value={form.postal_code || ""} onChange={set("postal_code")} onBlur={(e) => {
                const v = (e.target.value || "").trim().toUpperCase();
                setForm(f => ({ ...f, postal_code: v }));
                if (v && form.country === "CANADA" && !/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(v)) {
                  setError("Invalid Canadian postal code");
                } else if (v && form.country === "USA" && !/^\d{5}(-\d{4})?$/.test(v)) {
                  setError("Invalid US ZIP code");
                } else { setError(null); }
              }} />
            </Field>
          </Row>

          <Row>
            <Field label="Country">
              <select className={input} value={form.country || ""} onChange={set("country")}>
                <option>CANADA</option>
                <option>USA</option>
              </select>
            </Field>
            <Field label="Province">
              <select className={input} value={form.province || ""} onChange={set("province")}>
                <option value="">—</option>
                {provinceOptions.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </Row>

          <Row>
            <Field label="Phone">
              <input className={input} value={form.phone || ""} onChange={set("phone")} onBlur={(e) => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} />
            </Field>
            <Field label="Fax">
              <input className={input} value={form.fax || ""} onChange={set("fax")} onBlur={(e) => setForm(f => ({ ...f, fax: formatPhone(e.target.value) }))} />
            </Field>
          </Row>

          <Row>
            <Field label="Dealer #">
              <input className={input} value={form.dealer_number || ""} onChange={set("dealer_number")} />
            </Field>
            <Field label="RIN #">
              <input className={input} value={form.rin_number || ""} onChange={set("rin_number")} />
            </Field>
          </Row>

          <Row>
            <Field label="GST/HST #">
              <input className={input} value={form.tax_number || ""} onChange={set("tax_number")} />
            </Field>
            <Field label="PST #">
              <input className={input} value={form.pst_number || ""} onChange={set("pst_number")} />
            </Field>
          </Row>

          <Field label="Email">
            <input className={input} type="email" value={form.email || ""} onChange={set("email")} />
          </Field>

          <Row>
            <Field label="Driver Lic.">
              <input className={input} value={form.driver_license || ""} onChange={set("driver_license")} />
            </Field>
            <Field label="Expiry Date">
              <input className={input} type="date" value={form.driver_license_expiry || ""} onChange={set("driver_license_expiry")} />
            </Field>
          </Row>

          <Field label="Expense Type" labelUnderlined>
            <select className={input} value={form.default_expense_type || ""} onChange={set("default_expense_type")}>
              <option value="">—</option>
              {expenseCategories.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Row>
            <Field label="Default Account" wide>
              <input className={input} value={form.default_account || ""} onChange={set("default_account")} />
            </Field>
            <label className="flex items-center gap-2 pt-6">
              <input type="checkbox" checked={!!form.posted} onChange={(e) => setForm(f => ({ ...f, posted: e.target.checked }))} />
              <span className="font-semibold">Posted</span>
            </label>
          </Row>

          <Field label="Memo">
            <textarea
              rows={3}
              className={input}
              value={form.memo || ""}
              onChange={set("memo")}
            />
          </Field>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!form.tax_exempt} onChange={(e) => setForm(f => ({ ...f, tax_exempt: e.target.checked }))} />
            <span className="font-semibold">Tax Exempt</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded font-semibold disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100 font-semibold"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

const input = "w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30";

function Field({ label, labelBlue, labelUnderlined, wide, children }) {
  return (
    <div className={`grid grid-cols-[140px_1fr] gap-3 items-center ${wide ? "flex-1" : ""}`}>
      <label className={`font-semibold ${labelBlue ? "text-blue-600" : "text-gray-800"} ${labelUnderlined ? "underline" : ""}`}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ children }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}
