import { useState, useMemo } from "react";
import { X, Upload, CheckCircle2, XCircle, FileText } from "lucide-react";
import { supabase } from "../../supabaseClient";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const FIELD_ALIASES = {
  name: "name",
  "supplier name": "name",
  vendor: "name",
  category: "category",
  type: "category",
  address: "address",
  street: "address",
  city: "city",
  postal: "postal_code",
  postal_code: "postal_code",
  zip: "postal_code",
  "postal code": "postal_code",
  province: "province",
  state: "province",
  country: "country",
  phone: "phone",
  tel: "phone",
  telephone: "phone",
  fax: "fax",
  email: "email",
  "e-mail": "email",
  "dealer #": "dealer_number",
  dealer_number: "dealer_number",
  "rin #": "rin_number",
  "rin#": "rin_number",
  rin_number: "rin_number",
  "gst/hst": "tax_number",
  "gst/hst #": "tax_number",
  "gst hst": "tax_number",
  tax_number: "tax_number",
  gst: "tax_number",
  hst: "tax_number",
  "pst #": "pst_number",
  "pst#": "pst_number",
  pst_number: "pst_number",
  pst: "pst_number",
  default_expense_type: "default_expense_type",
  "expense type": "default_expense_type",
  "default account": "default_account",
  default_account: "default_account",
  memo: "memo",
  notes: "memo",
  tax_exempt: "tax_exempt",
  "tax exempt": "tax_exempt",
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ""));
}

function mapHeaderToField(header) {
  const key = String(header).trim().toLowerCase();
  return FIELD_ALIASES[key] || null;
}

function coerceTaxExempt(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return ["true", "yes", "y", "1", "x", "\u2713"].includes(s);
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export default function ImportSuppliersModal({ onClose, onComplete }) {
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const parsed = useMemo(() => {
    if (!csvText.trim()) return null;
    const rows = parseCSV(csvText);
    if (rows.length === 0) return null;

    const headerRow = rows[0];
    const fieldMap = headerRow.map((h) => ({
      header: h.trim(),
      field: mapHeaderToField(h),
    }));

    const dataRows = rows.slice(1).map((r, idx) => {
      const obj = { __row: idx + 2 };
      fieldMap.forEach((m, colIdx) => {
        if (!m.field) return;
        let val = (r[colIdx] ?? "").trim();
        if (m.field === "tax_exempt") val = coerceTaxExempt(val);
        if (val === "") return;
        obj[m.field] = val;
      });
      return obj;
    });

    return { headerRow, fieldMap, dataRows };
  }, [csvText]);

  const importable = (parsed?.dataRows || []).filter((r) => r.name);
  const invalidCount = (parsed?.dataRows || []).length - importable.length;

  async function runImport() {
    if (!importable.length) return;
    setImporting(true);
    setResults(null);
    const headers = await authHeaders();
    const out = [];
    for (const row of importable) {
      const { __row, ...payload } = row;
      try {
        const r = await fetch(`${API_URL}/suppliers`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const err = await r.text();
          out.push({ name: payload.name, ok: false, error: err.slice(0, 120) });
        } else {
          out.push({ name: payload.name, ok: true });
        }
      } catch (e) {
        out.push({ name: payload.name, ok: false, error: e.message });
      }
    }
    setResults(out);
    setImporting(false);
  }

  function loadSample() {
    setCsvText(
      [
        "name,category,city,province,phone,email",
        "LICENSING BUREAU,LICENSE FEES,MONT-LAURIER,QC,(819) 555-0188,licensing@bureau.qc.ca",
        "TIRE DISCOUNTER GROUP,PARTS,LAVAL,QC,(450) 555-0124,",
        "ORR MOTORS,AUTO SERVICE,GATINEAU,QC,(819) 555-0156,parts@orr.ca",
      ].join("\n")
    );
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
  }

  function handleClose() {
    if (results && results.some((r) => r.ok) && onComplete) onComplete();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-amber-400 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Import Suppliers from CSV</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-gray-700 hover:text-black"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!results && (
            <>
              <div className="text-sm text-gray-600">
                Paste CSV data below, or upload a .csv file. The first row must
                be the column header. Recognized columns:{" "}
                <code className="text-xs bg-gray-100 px-1 rounded">
                  name, category, address, city, postal, province, country, phone,
                  fax, email, dealer #, rin#, gst/hst, pst#, default_expense_type,
                  memo, tax_exempt
                </code>
                . Only <strong>name</strong> is required.
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer hover:bg-gray-50">
                  <FileText className="w-4 h-4" />
                  Upload .csv
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={handleFile}
                  />
                </label>
                <button
                  onClick={loadSample}
                  className="text-sm text-amber-600 hover:underline"
                >
                  Load sample data
                </button>
              </div>

              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`name,category,phone,email\nACME PARTS,PARTS,(555) 555-1212,sales@acme.ca`}
                className="w-full h-40 border rounded-md p-3 font-mono text-sm"
              />

              {parsed && (
                <div>
                  <div className="text-sm font-medium mb-2">
                    Preview ({importable.length} importable
                    {invalidCount > 0 && (
                      <span className="text-red-600">
                        , {invalidCount} skipped — missing name
                      </span>
                    )}
                    )
                  </div>
                  <div className="border rounded-md overflow-x-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-left sticky top-0">
                        <tr>
                          {parsed.fieldMap.map((m, i) => (
                            <th key={i} className="px-2 py-1.5 font-medium">
                              <div>{m.header}</div>
                              <div
                                className={`text-[10px] ${
                                  m.field
                                    ? "text-green-600"
                                    : "text-gray-400 italic"
                                }`}
                              >
                                {m.field || "(ignored)"}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.dataRows.map((row, i) => (
                          <tr
                            key={i}
                            className={`border-t ${
                              !row.name ? "bg-red-50" : ""
                            }`}
                          >
                            {parsed.fieldMap.map((m, ci) => (
                              <td key={ci} className="px-2 py-1">
                                {m.field
                                  ? typeof row[m.field] === "boolean"
                                    ? row[m.field]
                                      ? "\u2713"
                                      : ""
                                    : row[m.field] || ""
                                  : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {results && (
            <div>
              <div className="text-sm font-medium mb-3">
                Import complete — {results.filter((r) => r.ok).length} of{" "}
                {results.length} succeeded.
              </div>
              <div className="border rounded-md max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2 w-8">
                          {r.ok ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600" />
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2 text-xs text-red-600">
                          {r.error || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-3">
          {!results ? (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={!importable.length || importing}
                className="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing
                  ? "Importing\u2026"
                  : `Import ${importable.length} supplier${
                      importable.length === 1 ? "" : "s"
                    }`}
              </button>
            </>
          ) : (
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-amber-500 text-white rounded-md hover:bg-amber-600"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
