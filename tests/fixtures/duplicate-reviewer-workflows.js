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

function contactDifferentCompanyConflictSmokeCsv() {
  return csvRows([
    ["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile", "ZI_Person_LinkedIn_URL__c"],
    [
      "003L00000000011",
      "Taylor",
      "Mason",
      "Northstar Analytics",
      "taylor.mason@northstar.example",
      "Web",
      "2024-04-01",
      "(555) 010-4321",
      "",
      "https://www.linkedin.com/in/taylor-mason-1010/"
    ],
    [
      "003L00000000012",
      "Taylor",
      "Mason",
      "Civic Harbor",
      "taylor.mason@northstar.example",
      "Referral",
      "2025-04-01",
      "(555) 010-4321",
      "",
      "https://www.linkedin.com/in/taylor-mason-1010/"
    ]
  ]);
}

function contactSharedCompanyExactPhoneNameConflictSmokeCsv() {
  return csvRows([
    ["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"],
    [
      "003f200002O50cwAAB",
      "Karen",
      "Irish",
      "Out & Equal Workplace Advocates",
      "kirish@outandequal.org.invalid",
      "Web",
      "2024-04-01",
      "+1 415 694 6500",
      "(202) 372-5155"
    ],
    [
      "003f200002drJvyAAE",
      "Caryn",
      "Viverito",
      "Out & Equal Workplace Advocates",
      "",
      "Referral",
      "2025-04-01",
      "(415) 694-6500",
      "(202) 567-3306"
    ]
  ]);
}

function contactPairRegressionJson() {
  return JSON.stringify({
    schema: "salesforce-duplicate-reviewer.dataset",
    schemaVersion: 1,
    objectType: "contact",
    fileName: "salesforce-report-latest.json",
    source: {
      system: "salesforce",
      name: "Pair regression",
      format: "salesforce-records-json",
      orgAlias: "qa-prod-org",
      instanceUrl: "https://qa-prod-org.example.invalid"
    },
    records: [
      {
        Id: "003Vq00000MVET7IAP",
        Name: "Alpha One",
        FirstName: "Alpha",
        LastName: "One",
        Email: "alpha.one@example.invalid",
        Phone: "+1 555 010 0001",
        Company: "Example Org A",
        LeadSource: "Salesforce",
        CreatedDate: "2024-01-09T19:22:04.000Z"
      },
      {
        Id: "003Vq00000MVET8IAP",
        Name: "Alpha One",
        FirstName: "Alpha",
        LastName: "One",
        Email: "alpha.one@example.invalid",
        Phone: "+1 555 010 0001",
        Company: "Example Org A",
        LeadSource: "Salesforce",
        CreatedDate: "2024-02-10T14:31:37.000Z"
      },
      {
        Id: "003Vq00000zOGBrIAO",
        Name: "Beta Two",
        FirstName: "Beta",
        LastName: "Two",
        Email: "beta.two@example.invalid",
        Phone: "555-010-0002",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-17T11:52:14.000Z"
      },
      {
        Id: "003Vq00000zOGBsIAO",
        Name: "Beta Two",
        FirstName: "Beta",
        LastName: "Two",
        Email: "beta.two@example.invalid",
        Phone: "555-010-0002",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-17T11:52:14.000Z"
      },
      {
        Id: "003Vq00000zOGBzIAO",
        Name: "Gamma Three",
        FirstName: "Gamma",
        LastName: "Three",
        Email: "gamma.three@example.invalid",
        Phone: "",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-23T17:17:30.000Z"
      },
      {
        Id: "003Vq00000zOGC0IAO",
        Name: "Gamma Three",
        FirstName: "Gamma",
        LastName: "Three",
        Email: "gamma.three@example.invalid",
        Phone: "",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-23T17:17:30.000Z"
      },
      {
        Id: "003Vq00000zOXKLIA4",
        Name: "Delta Four",
        FirstName: "Delta",
        LastName: "Four",
        Email: "delta.four@example.invalid",
        Company: "Example Org B",
        LeadSource: "Salesforce",
        CreatedDate: "2024-12-22T16:13:31.000Z"
      },
      {
        Id: "003Vq00000zOXKMIA4",
        Name: "Echo Five",
        FirstName: "Echo",
        LastName: "Five",
        Email: "delta.four@example.invalid",
        Company: "Example Org B",
        LeadSource: "Salesforce",
        CreatedDate: "2025-01-06T12:14:09.000Z"
      }
    ]
  });
}

function contactMirrorRelationshipSmokeCsv() {
  return csvRows([
    ["Id", "First Name", "Last Name", "Company", "Email", "Mirror of"],
    ["003R00000000001", "Taylor", "Mason", "Northstar Analytics", "taylor.mason@northstar.example", "003R00000000002"],
    ["003R00000000002", "Taylor", "Mason", "Northstar Analytics", "taylor.mason@northstar.example", ""],
    ["003R00000000003", "Taylor", "Mason", "Northstar Analytics", "taylor.mason@northstar.example", ""]
  ]);
}

function contactPairRegressionJson() {
  return JSON.stringify({
    schema: "salesforce-duplicate-reviewer.dataset",
    schemaVersion: 1,
    objectType: "contact",
    fileName: "salesforce-report-latest.json",
    source: {
      system: "salesforce",
      name: "Pair regression",
      format: "salesforce-records-json",
      orgAlias: "qa-prod-org",
      instanceUrl: "https://qa-prod-org.example.invalid"
    },
    records: [
      {
        Id: "003Vq00000MVET7IAP",
        Name: "Alpha One",
        FirstName: "Alpha",
        LastName: "One",
        Email: "alpha.one@example.invalid",
        Phone: "+1 555 010 0001",
        Company: "Example Org A",
        LeadSource: "Salesforce",
        CreatedDate: "2024-01-09T19:22:04.000Z"
      },
      {
        Id: "003Vq00000MVET8IAP",
        Name: "Alpha One",
        FirstName: "Alpha",
        LastName: "One",
        Email: "alpha.one@example.invalid",
        Phone: "+1 555 010 0001",
        Company: "Example Org A",
        LeadSource: "Salesforce",
        CreatedDate: "2024-02-10T14:31:37.000Z"
      },
      {
        Id: "003Vq00000zOGBrIAO",
        Name: "Beta Two",
        FirstName: "Beta",
        LastName: "Two",
        Email: "beta.two@example.invalid",
        Phone: "555-010-0002",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-17T11:52:14.000Z"
      },
      {
        Id: "003Vq00000zOGBsIAO",
        Name: "Beta Two",
        FirstName: "Beta",
        LastName: "Two",
        Email: "beta.two@example.invalid",
        Phone: "555-010-0002",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-17T11:52:14.000Z"
      },
      {
        Id: "003Vq00000zOGBzIAO",
        Name: "Gamma Three",
        FirstName: "Gamma",
        LastName: "Three",
        Email: "gamma.three@example.invalid",
        Phone: "",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-23T17:17:30.000Z"
      },
      {
        Id: "003Vq00000zOGC0IAO",
        Name: "Gamma Three",
        FirstName: "Gamma",
        LastName: "Three",
        Email: "gamma.three@example.invalid",
        Phone: "",
        Company: "",
        LeadSource: "",
        CreatedDate: "2024-04-23T17:17:30.000Z"
      },
      {
        Id: "003Vq00000zOXKLIA4",
        Name: "Delta Four",
        FirstName: "Delta",
        LastName: "Four",
        Email: "delta.four@example.invalid",
        Company: "Example Org B",
        LeadSource: "Salesforce",
        CreatedDate: "2024-12-22T16:13:31.000Z"
      },
      {
        Id: "003Vq00000zOXKMIA4",
        Name: "Echo Five",
        FirstName: "Echo",
        LastName: "Five",
        Email: "delta.four@example.invalid",
        Company: "Example Org B",
        LeadSource: "Salesforce",
        CreatedDate: "2025-01-06T12:14:09.000Z"
      }
    ]
  });
}

function accountSmokeCsv() {
  return csvRows([
    ["Id", "Name", "Website", "Billing Street", "Billing City", "Billing State", "Billing Postal Code", "Billing Country"],
    ["001T00000000001", "Northstar Analytics Inc.", "northstar.example", "125 Market St", "San Francisco", "CA", "94105", "United States"],
    ["001T00000000002", "Northstar Analytics", "https://northstar.example", "125 Market Street", "San Francisco", "California", "94105", "US"],
    ["001T00000000003", "Association of Independent Colleges and Universities in New Jersey (AICUNJ)", "njcolleges.org", "", "", "", "", "United States"],
    ["001T00000000004", "Association of Colleges", "college-association.example", "", "", "", "", "United States"]
  ]);
}

function accountCompanyNormalizationSmokeCsv() {
  return csvRows([
    ["Id", "Name", "Website", "Phone", "Billing Street", "Billing City", "Billing State", "Billing Postal Code", "Billing Country"],
    ["001N00000000001", "The Ohio State University", "", "(614) 292-0000", "", "", "", "", "United States"],
    ["001N00000000002", "OSU", "", "(614) 292-0000", "", "", "", "", "United States"]
  ]);
}

function accountCommentaryNormalizationSmokeCsv() {
  return csvRows([
    ["Id", "Name", "Website", "Phone", "Billing Street", "Billing City", "Billing State", "Billing Postal Code", "Billing Country"],
    ["001N00000000011", "GPlus Europe Ltd (t/a Portland)", "", "(415) 555-2200", "", "", "", "", "United States"],
    ["001N00000000012", "GPlus Europe Ltd", "", "(415) 555-2200", "", "", "", "", "United States"]
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

function largeContactSmokeJson(targetBytes = 52 * 1024 * 1024) {
  const oversizedNote = "Deferred JSON parse smoke data. ".repeat(Math.ceil(targetBytes / 30));
  const records = [
    {
      Id: "003J00000000001",
      FirstName: "Taylor",
      LastName: "Mason",
      Company: "Northstar Analytics",
      Email: "taylor.mason@northstar.example",
      Phone: "(555) 010-4001",
      MobilePhone: "",
      Notes: oversizedNote
    },
    {
      Id: "003J00000000002",
      FirstName: "Taylor",
      LastName: "Mason",
      Company: "Northstar Analytics",
      Email: "taylor.mason@northstar.example",
      Phone: "(555) 010-4001",
      MobilePhone: "",
      Notes: oversizedNote
    }
  ];

  return JSON.stringify({
    objectType: "contact",
    fileName: "salesforce-report-latest.json",
    contractVersion: "salesforce-contact-rollback-v1",
    source: {
      orgAlias: "qa-smoke-org",
      instanceUrl: "https://qa-smoke-org.example.invalid"
    },
    records
  });
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
  accountCommentaryNormalizationSmokeCsv,
  accountCompanyNormalizationSmokeCsv,
  contactLastNameChangeSmokeCsv,
  contactDifferentCompanyConflictSmokeCsv,
  contactSharedCompanyExactPhoneNameConflictSmokeCsv,
  contactPairRegressionJson,
  contactMirrorRelationshipSmokeCsv,
  contactMissingIdSmokeCsv,
  contactSmokeCsv,
  largeContactSmokeCsv,
  largeContactSmokeJson
};
