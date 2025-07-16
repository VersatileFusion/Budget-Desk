require('dotenv').config();
const express = require("express");
const path = require("path");
const app = express();
const PORT = 3000;
const XLSX = require("xlsx");
const mongoose = require("mongoose");

// Row schema
const rowSchema = new mongoose.Schema({
  code: { type: String, required: false },
  title: { type: String, required: true },
  values: { type: [String], default: Array(8).fill("") },
});

// Sheet schema
const sheetSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rows: [rowSchema],
});

// Island schema
const islandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  sheets: [sheetSchema],
});

const Island = mongoose.model("Island", islandSchema);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected successfully."))
  .catch((err) => console.error("MongoDB connection error:", err));

// Serve static files (for Bootstrap, CSS, etc.)
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true })); // For parsing form data

// Set view engine to render HTML
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

function getAllSheetsData() {
  const workbook = XLSX.readFile("-5890780104330109183_63466543113236.xlsx");
  //console.log("Excel sheet names:", workbook.SheetNames);  Debug log
  const sheetNames = ["مصارف", "درآمدها", "هزینه ها", "منابع"];
  const sheetsData = {};
  sheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const dataRows = rows.filter(
      (row) => row.length > 1 && row[0] && !isNaN(row[0])
    );
    sheetsData[name] = dataRows.map((row) => ({
      code: String(row[0]),
      title: row[1],
      values: row.slice(2, 10).map((v) => (v === undefined ? "" : String(v))),
    }));
  });
  return sheetsData;
}

const islands = ["کیش", "قشم"];
const sheetNames = ["مصارف", "درآمدها", "هزینه ها", "منابع"];

async function importExcelToMongoIfNeeded() {
  const count = await Island.countDocuments();
  if (count > 0) return; // Already imported
  const workbook = XLSX.readFile("-5890780104330109183_63466543113236.xlsx");
  for (const islandName of islands) {
    const sheets = [];
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const dataRows = rows.filter(
        (row) => row.length > 1 && row[0] && !isNaN(row[0])
      );
      const rowObjs = dataRows.map((row) => ({
        code: String(row[0]),
        title: row[1],
        values: row.slice(2, 10).map((v) => (v === undefined ? "" : String(v))),
      }));
      sheets.push({ name: sheetName, rows: rowObjs });
    }
    await Island.create({ name: islandName, sheets });
  }
  console.log("Excel data imported to MongoDB.");
}

importExcelToMongoIfNeeded();

// Refactored GET / route
app.get("/", async (req, res) => {
  const editRowIndex = req.query.edit ? parseInt(req.query.edit, 10) : -1;
  const error = req.query.error || null;
  const island =
    req.query.island && islands.includes(req.query.island)
      ? req.query.island
      : "کیش";
  const sheet =
    req.query.sheet && sheetNames.includes(req.query.sheet)
      ? req.query.sheet
      : "مصارف";
  let tableData = [];
  try {
    const islandDoc = await Island.findOne({ name: island });
    if (islandDoc) {
      const sheetData = islandDoc.sheets.find((s) => s.name === sheet);
      if (sheetData) {
        tableData = sheetData.rows;
      }
    }
    res.render("table", {
      tableData,
      editRowIndex,
      error,
      sheet,
      sheetNames,
      island,
      islands,
    });
  } catch (err) {
    console.error("Error fetching island data:", err);
    res.status(500).send("Error fetching data.");
  }
});

// Refactored POST /add-row route
app.post("/add-row", async (req, res) => {
  const { code, title, values, sectionHeader, island, sheet } = req.body;
  const selectedIsland = island && islands.includes(island) ? island : "کیش";
  const selectedSheet = sheet && sheetNames.includes(sheet) ? sheet : "مصارف";
  try {
    const islandDoc = await Island.findOne({ name: selectedIsland });
    if (!islandDoc) throw new Error("Island not found");
    const sheetObj = islandDoc.sheets.find((s) => s.name === selectedSheet);
    if (!sheetObj) throw new Error("Sheet not found");
    // Code uniqueness check
    if (code && sheetObj.rows.some((row) => row.code === code)) {
      return res.redirect(
        `/?error=کد تکراری است (Duplicate code)&island=${encodeURIComponent(
          selectedIsland
        )}&sheet=${encodeURIComponent(selectedSheet)}`
      );
    }
    if (sectionHeader) {
      sheetObj.rows.push({ code: "", title: title, values: [] });
    } else {
      let vals = Array.isArray(values) ? values : [values];
      while (vals.length < 8) vals.push("");
      const newRow = { code: code, title: title, values: vals.slice(0, 8) };
      // Find parent code
      function getParentCode(code) {
        let codeStr = String(code);
        for (let i = codeStr.length - 1; i >= 0; i--) {
          if (codeStr[i] !== "0") {
            return codeStr.substring(0, i) + "0".repeat(codeStr.length - i);
          }
        }
        return null;
      }
      const parentCode = getParentCode(code);
      // Find all siblings (children of the same parent)
      let siblingIndexes = [];
      for (let i = 0; i < sheetObj.rows.length; i++) {
        if (getParentCode(sheetObj.rows[i].code) === parentCode) {
          siblingIndexes.push(i);
        }
      }
      // Find the correct insert position among siblings
      let insertIdx = -1;
      if (siblingIndexes.length > 0) {
        for (let j = 0; j < siblingIndexes.length; j++) {
          const siblingIdx = siblingIndexes[j];
          if (Number(code) < Number(sheetObj.rows[siblingIdx].code)) {
            insertIdx = siblingIdx;
            break;
          }
        }
        if (insertIdx === -1) {
          insertIdx = siblingIndexes[siblingIndexes.length - 1] + 1;
        }
      } else {
        for (let i = 0; i < sheetObj.rows.length; i++) {
          if (String(sheetObj.rows[i].code) === parentCode) {
            insertIdx = i + 1;
            break;
          }
        }
        if (insertIdx === -1) {
          insertIdx = sheetObj.rows.length;
        }
      }
      sheetObj.rows.splice(insertIdx, 0, newRow);
    }
    await islandDoc.save();
    res.redirect(
      `/?island=${encodeURIComponent(
        selectedIsland
      )}&sheet=${encodeURIComponent(selectedSheet)}`
    );
  } catch (err) {
    console.error("Error adding row:", err);
    res.status(500).send("Error adding row.");
  }
});

// Refactored POST /edit-row route
app.post("/edit-row", async (req, res) => {
  const { rowIndex, code, title, values, island, sheet } = req.body;
  const selectedIsland = island && islands.includes(island) ? island : "کیش";
  const selectedSheet = sheet && sheetNames.includes(sheet) ? sheet : "مصارف";
  try {
    const islandDoc = await Island.findOne({ name: selectedIsland });
    if (!islandDoc) throw new Error("Island not found");
    const sheetObj = islandDoc.sheets.find((s) => s.name === selectedSheet);
    if (!sheetObj) throw new Error("Sheet not found");
    const idx = parseInt(rowIndex, 10);
    // Code uniqueness check (ignore current row)
    if (
      code &&
      sheetObj.rows.some((row, i) => row.code === code && i !== idx)
    ) {
      return res.redirect(
        `/?error=کد تکراری است (Duplicate code)&island=${encodeURIComponent(
          selectedIsland
        )}&sheet=${encodeURIComponent(selectedSheet)}`
      );
    }
    if (!isNaN(idx) && sheetObj.rows[idx]) {
      sheetObj.rows[idx].code = code;
      sheetObj.rows[idx].title = title;
      sheetObj.rows[idx].values = Array.isArray(values) ? values : [values];
    } else {
      console.log("Edit failed: invalid index", rowIndex);
    }
    await islandDoc.save();
    res.redirect(
      `/?island=${encodeURIComponent(
        selectedIsland
      )}&sheet=${encodeURIComponent(selectedSheet)}`
    );
  } catch (err) {
    console.error("Error editing row:", err);
    res.status(500).send("Error editing row.");
  }
});

// Refactored POST /delete-row route
app.post("/delete-row", async (req, res) => {
  const { rowIndex, island, sheet } = req.body;
  const selectedIsland = island && islands.includes(island) ? island : "کیش";
  const selectedSheet = sheet && sheetNames.includes(sheet) ? sheet : "مصارف";
  try {
    const islandDoc = await Island.findOne({ name: selectedIsland });
    if (!islandDoc) throw new Error("Island not found");
    const sheetObj = islandDoc.sheets.find((s) => s.name === selectedSheet);
    if (!sheetObj) throw new Error("Sheet not found");
    const idx = parseInt(rowIndex, 10);
    if (!isNaN(idx) && idx >= 0 && idx < sheetObj.rows.length) {
      sheetObj.rows.splice(idx, 1);
    } else {
      console.log("Delete failed: invalid index", rowIndex);
    }
    await islandDoc.save();
    res.redirect(
      `/?island=${encodeURIComponent(
        selectedIsland
      )}&sheet=${encodeURIComponent(selectedSheet)}`
    );
  } catch (err) {
    console.error("Error deleting row:", err);
    res.status(500).send("Error deleting row.");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
