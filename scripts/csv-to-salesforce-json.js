#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { once } = require("node:events");
const path = require("node:path");

const USAGE = "Usage: csv-to-salesforce-json.js --input <salesforce-report.csv> --output <salesforce-report.json>";

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) throw new Error(USAGE);

  const rowCount = await convertCsvToJson(args.input, args.output);
  console.log(`Converted ${rowCount} CSV rows to ${args.output}`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") parsed.input = requiredValue(args, ++index, arg);
    else if (arg === "--output") parsed.output = requiredValue(args, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

async function convertCsvToJson(inputPath, outputPath) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.tmp.${process.pid}`);
  const output = fs.createWriteStream(tempPath, { encoding: "utf8" });
  const input = fs.createReadStream(inputPath, { encoding: "utf8" });
  const parser = new CsvParser();

  let sawHeader = false;
  let rowCount = 0;
  let firstDataRow = true;

  try {
    await write(output, "{");

    for await (const chunk of input) {
      for (const row of parser.write(chunk)) {
        if (!hasData(row)) continue;
        if (!sawHeader) {
          sawHeader = true;
          await write(output, `"columns":${JSON.stringify(cleanHeader(row))},"rows":[`);
          continue;
        }
        if (!firstDataRow) await write(output, ",");
        await write(output, JSON.stringify(row));
        firstDataRow = false;
        rowCount += 1;
      }
    }

    for (const row of parser.end()) {
      if (!hasData(row)) continue;
      if (!sawHeader) {
        sawHeader = true;
        await write(output, `"columns":${JSON.stringify(cleanHeader(row))},"rows":[`);
        continue;
      }
      if (!firstDataRow) await write(output, ",");
      await write(output, JSON.stringify(row));
      firstDataRow = false;
      rowCount += 1;
    }

    if (!sawHeader) throw new Error(`CSV has no header row: ${inputPath}`);
    await write(output, `],"rowCount":${rowCount}}\n`);
    output.end();
    await once(output, "finish");
    await fsp.rename(tempPath, outputPath);
  } catch (error) {
    output.destroy();
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return rowCount;
}

async function write(stream, value) {
  if (!stream.write(value)) await once(stream, "drain");
}

function hasData(row) {
  return row.some((cell) => String(cell).trim());
}

function cleanHeader(row) {
  return row.map((value, index) => {
    const text = String(value ?? "").trim();
    return index === 0 ? text.replace(/^\uFEFF/, "") : text;
  });
}

class CsvParser {
  constructor() {
    this.row = [];
    this.cell = "";
    this.inQuotes = false;
    this.pendingQuote = false;
  }

  write(chunk) {
    const rows = [];
    for (const char of chunk) {
      const emitted = this.processChar(char);
      if (emitted) rows.push(emitted);
    }
    return rows;
  }

  end() {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.cell || this.row.length) {
      this.row.push(this.cell);
      const row = this.row;
      this.row = [];
      this.cell = "";
      return [row];
    }
    return [];
  }

  processChar(char) {
    if (this.pendingQuote) {
      if (char === '"') {
        this.cell += '"';
        this.pendingQuote = false;
        return null;
      }
      this.pendingQuote = false;
      this.inQuotes = false;
    }

    if (this.inQuotes) {
      if (char === '"') this.pendingQuote = true;
      else this.cell += char;
      return null;
    }

    if (char === '"') {
      this.inQuotes = true;
      return null;
    }

    if (char === ",") {
      this.row.push(this.cell);
      this.cell = "";
      return null;
    }

    if (char === "\n") {
      this.row.push(this.cell);
      const row = this.row;
      this.row = [];
      this.cell = "";
      return row;
    }

    if (char !== "\r") this.cell += char;
    return null;
  }
}
