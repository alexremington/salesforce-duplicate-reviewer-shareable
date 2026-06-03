function contactSmokeCsv() {
  const rows = [["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"]];
  const names = [
    ["Maya", "Rodriguez"],
    ["John", "Pierce"],
    ["Priya", "Shah"],
    ["Daniel", "Kim"],
    ["Aisha", "Johnson"],
    ["Lucas", "Martin"],
    ["Nora", "Bennett"],
    ["Ethan", "Cole"],
    ["Sofia", "Rivera"],
    ["Caleb", "Morgan"],
    ["Leah", "Patel"],
    ["Owen", "Reed"],
    ["Amelia", "Stone"],
    ["Noah", "Brooks"],
    ["Grace", "Chen"],
    ["Isaac", "Turner"],
    ["Emma", "Walker"],
    ["Liam", "Foster"],
    ["Zoe", "Carter"],
    ["Henry", "Morris"],
    ["Mia", "Hayes"],
    ["Leo", "Parker"],
    ["Chloe", "Bailey"],
    ["Miles", "Cooper"]
  ];
  for (let index = 1; index <= 24; index += 1) {
    const firstId = `003T${String(index * 2 - 1).padStart(11, "0")}`;
    const secondId = `003T${String(index * 2).padStart(11, "0")}`;
    const nearMatch = index % 3 === 0;
    const email = nearMatch ? "" : `contact${index}@example.com`;
    const [firstName, lastName] = names[index - 1];
    const company = index % 2 ? `Northstar Analytics ${index}` : `CivicWire ${index}`;
    const firstPhone = `(555) 010-${String(index).padStart(4, "0")}`;
    const secondMobile = nearMatch ? `(555) 990-${String(index).padStart(4, "0")}` : `(555) 020-${String(index).padStart(4, "0")}`;
    const day = String((index % 28) + 1).padStart(2, "0");
    rows.push([firstId, firstName, lastName, company, email, "Web", `2024-01-${day}T09:00:00.000Z`, firstPhone, ""]);
    rows.push([secondId, firstName, lastName, `${company} Inc.`, email, "Referral", `2025-01-${day}T09:00:00.000Z`, "", secondMobile]);
  }
  return csvRows(rows);
}

function contactMissingIdSmokeCsv() {
  return csvRows([
    ["Full Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"],
    ["Ada Lovelace", "Northstar Analytics", "ada@example.com", "Web", "2024-01-01", "(555) 111-0101", ""],
    ["Ada Lovelace", "Northstar Analytics Inc.", "ada@example.com", "Referral", "2024-02-01", "", "(555) 222-0101"]
  ]);
}

function contactLastNameChangeSmokeCsv() {
  return csvRows([
    ["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"],
    ["003L00000000001", "Jordan", "Taylor", "POLITICO", "jordan.taylor@politico.com", "Web", "2024-03-01", "", ""],
    ["003L00000000002", "Jordan", "Rivera", "POLITICO", "jordan.rivera@politico.com", "Referral", "2025-03-01", "", ""]
  ]);
}

function accountSmokeCsv() {
  return csvRows([
    ["Id", "Name", "Website", "Billing Street", "Billing City", "Billing State", "Billing Postal Code", "Billing Country"],
    ["001T00000000001", "Northstar Analytics Inc.", "northstar.example", "125 Market St", "San Francisco", "CA", "94105", "United States"],
    ["001T00000000002", "Northstar Analytics", "https://northstar.example", "125 Market Street", "San Francisco", "California", "94105", "US"]
  ]);
}

function largeContactSmokeCsv(groupCount = 300) {
  const rows = [["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"]];
  for (let index = 1; index <= groupCount; index += 1) {
    const firstId = `003P${String(index * 2 - 1).padStart(11, "0")}`;
    const secondId = `003P${String(index * 2).padStart(11, "0")}`;
    const lastName = `Perf${String(index).padStart(4, "0")}`;
    const company = `Performance Fixture ${String(index).padStart(4, "0")}`;
    const email = `person${index}@perf${index}.example`;
    const day = String((index % 28) + 1).padStart(2, "0");
    rows.push([firstId, "Taylor", lastName, company, email, "Web", `2024-02-${day}T09:00:00.000Z`, `(555) 300-${String(index).padStart(4, "0")}`, ""]);
    rows.push([secondId, "Taylor", lastName, `${company} LLC`, email, "Referral", `2025-02-${day}T09:00:00.000Z`, "", `(555) 400-${String(index).padStart(4, "0")}`]);
  }
  return csvRows(rows);
}

function csvRows(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = {
  accountSmokeCsv,
  contactLastNameChangeSmokeCsv,
  contactMissingIdSmokeCsv,
  contactSmokeCsv,
  largeContactSmokeCsv
};
