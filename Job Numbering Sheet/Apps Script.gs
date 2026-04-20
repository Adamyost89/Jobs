// Installable onEdit trigger
function onEditInstalled(e) {
  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = sheet.getName();
  var dataColumn = range.getColumn();
  var row = range.getRow();

  Logger.log("onEditInstalled triggered on sheet: " + sheetName + ", Column: " + dataColumn + ", Row: " + row);

  // Update Paid 2026 sheet when month selector (A1) is changed
  if (sheetName === "Paid 2026" && dataColumn === 1 && row === 1) {
    updatePaid2026Sheet();
    return; // Exit early to avoid processing other logic
  }

  // Auto-add new job to Commission Data when Salesperson (I) is set on 2025 or 2026 sheet
  if ((sheetName === "2025" || sheetName === "2026") && dataColumn === 9 && row >= 2) {
    var salesperson = sheet.getRange(row, 9).getValue(); // I - Salesperson
    var jobNumber = sheet.getRange(row, 2).getValue(); // B - Job Number
    var leadNumber = sheet.getRange(row, 1).getValue(); // A - Lead Number
    
    if (jobNumber && salesperson) {
      Logger.log("Salesperson set on " + sheetName + ", Row: " + row + ", Job: " + jobNumber + ", Salesperson: " + salesperson);
      addJobToCommissionData(leadNumber, jobNumber, salesperson, sheetName);
    }
  }

  // Commission update watch on 2025/2026 K (column 11) - only update if row >= 2
  if ((sheetName === "2025" || sheetName === "2026") && dataColumn === 11 && row >= 2) {
    var kValue = sheet.getRange(row, 11).getValue(); // K
    Logger.log("K changed on " + sheetName + ", Row: " + row + ", K Value: " + kValue);
    if (kValue && typeof kValue === "number" && kValue > 0) {
      processCommissionUpdate(sheet, row, sheetName);
    }
  }

  // Update AC column with date when K column is updated on 2024 or 2025 sheets
  if ((sheetName === "2024" || sheetName === "2025") && dataColumn === 11 && row >= 2) {
    sheet.getRange(row, 29).setValue(new Date()); // AC is column 29
    Logger.log("Updated AC column with date on " + sheetName + ", Row: " + row);
  }

  // Handle edits on salesperson sheets (2025 and 2026)
  var salespersonSheets = ["2025 Brett", "2025 Drew", "2025 James", "2025 Geoff", "2025 Will", "2026 Brett", "2026 Drew", "2026 James", "2026 Mike"];
  if (salespersonSheets.indexOf(sheetName) !== -1 && dataColumn === 11 && row >= 2) {
    var kValue = sheet.getRange(row, 11).getValue(); // K
    Logger.log("K changed on " + sheetName + ", Row: " + row + ", K Value: " + kValue);
    // Set L (column 12) to true when K is edited
    sheet.getRange(row, 12).setValue(true); // L
    Logger.log("Set L to true on " + sheetName + ", Row: " + row);
    // Sync paid amount to Commission Data when K is edited on salesperson sheet.
    syncPaidAmountToCommissionDataFromSalespersonSheet(sheet, row, sheetName);
  }

  // Sync paid amount when user marks commission as paid (L checkbox) on salesperson sheets
  if (salespersonSheets.indexOf(sheetName) !== -1 && dataColumn === 12 && row >= 2) {
    var isPaidChecked = sheet.getRange(row, 12).getValue(); // L
    if (isPaidChecked === true) {
      Logger.log("L checked on " + sheetName + ", Row: " + row + ". Syncing paid amount.");
      syncPaidAmountToCommissionDataFromSalespersonSheet(sheet, row, sheetName);
    }
  }

  // 2025/2026 sheet logic
  if (sheetName === "2025" || sheetName === "2026") {
    // Timestamp E when C receives a value and E is blank and not a formula
    if (dataColumn === 3 && e.value !== '') {
      var timestampCell = sheet.getRange(row, 5); // E
      if (!hasFormulaCell(timestampCell) && timestampCell.isBlank()) {
        timestampCell.setValue(new Date());
      }
    }

    // Apply row colors on every edit
    applyRowColor(sheet, row);
  }
}

// Detect commission year for a row using explicit salesperson/year hints, then job number prefix fallback.
function detectCommissionYear(leadNumber, jobNumber, salesperson) {
  var salespersonStr = String(salesperson || "").trim();
  if (salespersonStr === "Mike") return "2026";
  if (salespersonStr === "Geoff" || salespersonStr === "Will") return "2025";

  var jobStr = String(jobNumber || "").trim();
  if (/^2026/.test(jobStr)) return "2026";
  if (/^2025/.test(jobStr)) return "2025";

  var leadNum = parseInt(leadNumber, 10);
  if (!isNaN(leadNum) && leadNum > 2000) return "2026";
  return "2025";
}

// Sync a single salesperson-sheet row's paid total into Commission Data column D.
function syncPaidAmountToCommissionDataFromSalespersonSheet(sheet, row, sheetName) {
  var elevatedSpreadsheetId = "1eO365hmI2Nm9_YssKGka92teOkoRD0uzSnM0r31D7ek";
  try {
    var sheetNameParts = String(sheetName || "").split(" ");
    var year = sheetNameParts[0] || "";
    var salesperson = sheetNameParts.slice(1).join(" ").trim();
    if ((year !== "2025" && year !== "2026") || !salesperson) {
      Logger.log("Unable to parse year/salesperson from sheet name: " + sheetName);
      return;
    }

    var leadNumber = sheet.getRange(row, 1).getValue(); // A
    var jobNumber = sheet.getRange(row, 2).getValue();  // B
    if (!jobNumber) {
      Logger.log("No job number found on " + sheetName + " row " + row + ". Skipping paid sync.");
      return;
    }

    var paidAmount = getPaidAmountFromTotalCommissions(jobNumber, salesperson, year);
    var elevatedSpreadsheet = SpreadsheetApp.openById(elevatedSpreadsheetId);
    var commissionDataSheet = elevatedSpreadsheet.getSheetByName("Commission Data");
    if (!commissionDataSheet) {
      commissionDataSheet = elevatedSpreadsheet.insertSheet("Commission Data");
      commissionDataSheet.getRange("A1:F1").setValues([["Lead Number", "Job Number", "Salesperson", "Paid", "Owed", "Override"]]);
    }

    var lastRow = commissionDataSheet.getLastRow();
    var foundRow = -1;
    if (lastRow >= 2) {
      var data = commissionDataSheet.getRange("A2:F" + lastRow).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim() === String(jobNumber).trim() && String(data[i][2]).trim() === salesperson) {
          foundRow = i + 2;
          break;
        }
      }
    }

    if (foundRow === -1) {
      // Create entry if missing so paid amount is not dropped.
      foundRow = Math.max(2, lastRow + 1);
      commissionDataSheet.getRange(foundRow, 1, 1, 6).setValues([[
        leadNumber || "",
        jobNumber,
        salesperson,
        paidAmount,
        0,
        false
      ]]);
      Logger.log("Created Commission Data row for job " + jobNumber + ", " + salesperson + " with paid $" + paidAmount);
    } else {
      commissionDataSheet.getRange(foundRow, 4).setValue(paidAmount); // D Paid
      Logger.log("Updated Commission Data paid amount for job " + jobNumber + ", " + salesperson + " to $" + paidAmount);
    }
  } catch (error) {
    Logger.log("Error syncing paid amount from salesperson sheet row " + row + ": " + error.toString());
  }
}

// Utility to detect if a single cell has a formula
function hasFormulaCell(rng) {
  try {
    var f = rng.getFormula();
    return f && f.length > 0;
  } catch (err) {
    return false;
  }
}

// Row color palette
const COLOR_ROW_YELLOW = "#f6c026";   // darker yellow
const COLOR_ROW_BLUE   = "#8ab4f8";   // lighter blue
const COLOR_ROW_GREEN  = "#34a853";   // green
const COLOR_ROW_RED    = "#ea4335";   // red for under 32 percent

// Convert "58.23%" or 0.5823 or 58.23 to 58.23
function asPercentNumber(val) {
  if (typeof val === "number") return val <= 1 ? val * 100 : val;
  if (typeof val === "string") {
    var cleaned = val.replace("%", "").replace(/,/g, "").trim();
    var num = parseFloat(cleaned);
    return isNaN(num) ? NaN : num;
  }
  return NaN;
}

// Row color rules for 2025/2026 using O F S U
function applyRowColor(sheet, row) {
  try {
    var sheetName = sheet ? sheet.getName() : "";
    if (!sheet || (sheetName !== "2025" && sheetName !== "2026") || row < 2) return;

    var sVal = sheet.getRange("S" + row).getValue();                 // S checkbox
    var uVal = sheet.getRange("U" + row).getValue();                 // U status text
    var oRaw = sheet.getRange("O" + row).getValue();                 // O GP percent from formula
    var fVal = Number(sheet.getRange("F" + row).getValue()) || 0;    // F selling price

    var oPct = asPercentNumber(oRaw);
    var inBilling = String(uVal || "").trim().toLowerCase() === "in billing";
    var active = sVal === true && inBilling;

    var color = null;

    if (active) {
      if (isFinite(oPct) && oPct < 32) {
        color = COLOR_ROW_RED;
      } else if ((isFinite(oPct) && oPct < 50) || fVal < 5000) {
        color = COLOR_ROW_YELLOW;
      } else if ((isFinite(oPct) && oPct >= 50 && oPct < 60) && fVal > 5000) {
        color = COLOR_ROW_BLUE;
      } else if ((isFinite(oPct) && oPct >= 60) && fVal > 5000) {
        color = COLOR_ROW_GREEN;
      }
    }

    var rowRange = sheet.getRange(row, 1, 1, 22); // A through V
    rowRange.setBackground(color || null);
  } catch (err) {
    Logger.log("applyRowColor error on row " + row + ": " + err);
  }
}

// Get James commission rate based on column J totals (for bonus structure)
function getJamesCommissionRate(year) {
  var commissionsSpreadsheetId = "19d5c8TpaUh9r5Bzw4Rh6zATcAsrS480NExlaS_tYMJs";
  
  try {
    var commissionsSpreadsheet = SpreadsheetApp.openById(commissionsSpreadsheetId);
    var jamesSheetName = "James " + year;
    var jamesSheet = commissionsSpreadsheet.getSheetByName(jamesSheetName);
    
    if (!jamesSheet) {
      Logger.log("Sheet '" + jamesSheetName + "' not found for James bonus calculation, using default rate");
      return 0.10; // Default to 10% if sheet not found
    }
    
    var lastRow = jamesSheet.getLastRow();
    if (lastRow < 2) {
      return 0.10; // No data, use base rate
    }
    
    // Sum column J values (skip header row)
    var jValues = jamesSheet.getRange(2, 10, lastRow - 1, 1).getValues(); // Column J is column 10
    var totalPaid = 0;
    
    for (var i = 0; i < jValues.length; i++) {
      var jValue = jValues[i][0];
      if (typeof jValue === "number" && !isNaN(jValue)) {
        totalPaid += jValue;
      } else if (typeof jValue === "string") {
        var parsed = parseFloat(jValue.replace(/[^0-9.-]+/g, ""));
        if (!isNaN(parsed)) {
          totalPaid += parsed;
        }
      }
    }
    
    Logger.log("James " + year + " total paid from column J: $" + totalPaid);
    
    // If total paid >= $1,000,000, return 10.5%, else 10%
    if (totalPaid >= 1000000) {
      return 0.105;
    } else {
      return 0.10;
    }
  } catch (error) {
    Logger.log("Error calculating James commission rate for " + year + ": " + error.toString());
    return 0.10; // Default to 10% on error
  }
}

// Get James 2025 commission rate: 10.5% when H75 on "2025 James" (31d7ek) >= 1,000,000; else 4% / 10% by job ID.
function getJames2025CommissionRate(jobIdNum) {
  var elevatedSpreadsheetId = "1eO365hmI2Nm9_YssKGka92teOkoRD0uzSnM0r31D7ek";
  try {
    var spreadsheet = SpreadsheetApp.openById(elevatedSpreadsheetId);
    var jamesSheet = spreadsheet.getSheetByName("2025 James");
    if (!jamesSheet) {
      return jobIdNum < 1203 ? 0.04 : 0.10;
    }
    var h75 = jamesSheet.getRange("H75").getValue();
    var h75Num = (typeof h75 === "number" && !isNaN(h75)) ? h75 : (typeof h75 === "string" ? parseFloat(h75.replace(/[^0-9.-]+/g, "")) : NaN);
    if (typeof h75Num === "number" && !isNaN(h75Num) && h75Num >= 1000000) {
      return 0.105;
    }
    return jobIdNum < 1203 ? 0.04 : 0.10;
  } catch (error) {
    Logger.log("Error reading H75 for James 2025 rate: " + error.toString());
    return jobIdNum < 1203 ? 0.04 : 0.10;
  }
}

// Commission updates
function processCommissionUpdate(sheet, row, year) {
  // Default to 2025 if year not provided
  if (!year) {
    year = "2025";
  }
  
  var jobNumber = sheet.getRange(row, 2).getValue(); // B
  var jobId = sheet.getRange(row, 1).getValue();     // A
  Logger.log("Job Number from " + year + ": " + jobNumber + ", Job ID: " + jobId);

  var totalValue = sheet.getRange(row, 11).getValue(); // K
  totalValue = (typeof totalValue === "number" && !isNaN(totalValue)) ? totalValue : 0;

  // Define salespeople and rates based on year
  var salespeople;
  var jobIdNum = parseInt(jobId, 10) || 0;

  if (year === "2025") {
    salespeople = ["Brett", "Drew", "James", "Geoff"];
  } else if (year === "2026") {
    salespeople = ["Brett", "Drew", "James", "Mike"];
  } else {
    Logger.log("Invalid year: " + year);
    return;
  }

  salespeople.forEach(function(salesperson) {
    // Skip recalculating if Override (F) is TRUE - user locked this payout
    if (getCommissionDataValue(jobNumber, salesperson, "L") === true) return;

    // Get J value (paid) from Commission Data
    var jValue = getCommissionDataValue(jobNumber, salesperson, "J") || 0;
    var leadNumber = getCommissionDataValue(jobNumber, salesperson, "Lead");
    var leadNum = parseInt(leadNumber, 10) || 0;

    // Calculate commission rate
    var commissionRate;
    if (year === "2025") {
      // 2025 commission logic (keep existing)
      if (salesperson === "Drew") {
        // Drew gets 1% on ALL jobs after lead 1857 regardless of salesperson
        commissionRate = leadNum > 1857 ? 0.01 : 0.05;
      } else if (salesperson === "Geoff") {
        // Geoff: 5% for leads after 1749, 0% before
        commissionRate = jobIdNum > 1749 ? 0.05 : 0.00;
      } else if (salesperson === "James") {
        // James: 10.5% when H75 >= 1M on "2025 James" (31d7ek), else 4% before 1203 / 10% from 1203
        commissionRate = getJames2025CommissionRate(jobIdNum);
      } else {
        commissionRate = 0.05; // Brett and others: 5%
      }
    } else if (year === "2026") {
      // 2026 commission logic (simple rates)
      if (salesperson === "Brett") {
        commissionRate = 0.05; // 5%
      } else if (salesperson === "Drew") {
        commissionRate = 0.01; // 1%
      } else if (salesperson === "James") {
        // James: 10% base, 10.5% after $1M paid (from column H)
        commissionRate = getJamesCommissionRate("2026");
      } else if (salesperson === "Mike") {
        commissionRate = 0.05; // 5%
      } else {
        commissionRate = 0;
      }
    } else {
      commissionRate = 0;
    }

    var totalCommission = totalValue * commissionRate;
    var newKValue = totalCommission - jValue;
    if (newKValue < 0) newKValue = 0;
    // James 2025 at 10.5%: do not create new owed on jobs already fully paid at old rate (4% or 10%)
    if (year === "2025" && salesperson === "James" && commissionRate === 0.105) {
      var oldRate = jobIdNum < 1203 ? 0.04 : 0.10;
      if (jValue >= oldRate * totalValue - 0.01) newKValue = 0;
    }
    // Round to 2 decimal places to avoid floating point errors
    newKValue = Math.round(newKValue * 100) / 100;

    // Update Commission Data (replace, don't add, since we already subtracted paid amount)
    // Pass true to only update existing entries, don't create new ones
    updateCommissionData(jobNumber, salesperson, null, newKValue, null, true);
  });
  
  // For 2025: Drew gets 1% on ALL jobs after lead 1857, even if he's not the salesperson
  if (year === "2025") {
    var leadNumber = sheet.getRange(row, 1).getValue(); // Column A
    var leadNum = parseInt(leadNumber, 10) || 0;
    if (leadNum > 1857 && getCommissionDataValue(jobNumber, "Drew", "L") !== true) {
      var drewJValue = getCommissionDataValue(jobNumber, "Drew", "J") || 0;
      
      var drewCommission = totalValue * 0.01;
      var drewNewKValue = drewCommission - drewJValue;
      if (drewNewKValue < 0) drewNewKValue = 0;
      
      // Round to 2 decimal places to avoid floating point errors
      drewNewKValue = Math.round(drewNewKValue * 100) / 100;

      // Update Commission Data (replace, don't add, since we already subtracted paid amount)
      updateCommissionData(jobNumber, "Drew", null, drewNewKValue, null, true);
    }
  }

  // For 2026: Drew gets 1% commission if he's listed in column AA (column 27)
  if (year === "2026") {
    var aaValue = sheet.getRange(row, 27).getValue(); // Column AA
    var aaValueStr = String(aaValue || "").trim();
    if ((aaValueStr.toLowerCase() === "drew" || aaValueStr.toLowerCase().indexOf("drew") !== -1) && getCommissionDataValue(jobNumber, "Drew", "L") !== true) {
      var drewJValue = getCommissionDataValue(jobNumber, "Drew", "J") || 0;
      
      var drewCommission = totalValue * 0.01;
      var drewNewKValue = drewCommission - drewJValue;
      if (drewNewKValue < 0) drewNewKValue = 0;
      
      // Round to 2 decimal places to avoid floating point errors
      drewNewKValue = Math.round(drewNewKValue * 100) / 100;
      
      // Update Commission Data (replace, don't add, since we already subtracted paid amount)
      // Pass true to only update existing entries, don't create new ones
      updateCommissionData(jobNumber, "Drew", null, drewNewKValue, null, true);
      Logger.log("Added Drew's commission for 2026 job " + jobNumber + " based on AA column value: " + aaValueStr);
    }
  }
}

// Add new job to Commission Data when salesperson is set
function addJobToCommissionData(leadNumber, jobNumber, salesperson, year) {
  // Default to 2025 if year not provided
  if (!year) {
    year = "2025";
  }
  
  var validSalespeople2025 = ["Brett", "Drew", "James", "Geoff", "Will"];
  var validSalespeople2026 = ["Brett", "Drew", "James", "Mike"];
  var validSalespeople = year === "2025" ? validSalespeople2025 : validSalespeople2026;

  var isValidSalesperson = validSalespeople.indexOf(salesperson) !== -1;
  if (!isValidSalesperson) {
    Logger.log("Invalid salesperson: " + salesperson + " for year " + year + ". Skipping base row but still evaluating Drew rules.");
  } else {
    // Check if base salesperson entry already exists
    var existingValue = getCommissionDataValue(jobNumber, salesperson, "K");
    if (existingValue === null) {
      // Get historical paid amount from Total Commissions
      var paidAmount = getPaidAmountFromTotalCommissions(jobNumber, salesperson, year);
      // Create the entry (pass false to allow creating new entries)
      updateCommissionData(jobNumber, salesperson, paidAmount, 0, false, false);
      Logger.log("Added new job to Commission Data: " + jobNumber + " for " + salesperson + " (" + year + ")");
    } else {
      Logger.log("Entry already exists for Job: " + jobNumber + ", Salesperson: " + salesperson);
    }
  }

  // For 2025: leads > 1857, also add Drew's entry if he's not the salesperson.
  // This should run even when column I has a non-standard salesperson.
  if (year === "2025") {
    var leadNum = parseInt(leadNumber, 10) || 0;
    if (leadNum > 1857 && salesperson !== "Drew") {
      var drewExists = getCommissionDataValue(jobNumber, "Drew", "K");
      if (drewExists === null) {
        var drewPaidAmount = getPaidAmountFromTotalCommissions(jobNumber, "Drew", year);
        updateCommissionData(jobNumber, "Drew", drewPaidAmount, 0, false, false);
        Logger.log("Added Drew's sales manager commission entry for Job: " + jobNumber);
      }
    }
  }
  
  // For 2026: also add Drew's entry if he's listed in column AA (column 27)
  if (year === "2026" && salesperson !== "Drew") {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var yearSheet = spreadsheet.getSheetByName(year);
    if (yearSheet) {
      var lastRow = yearSheet.getLastRow();
      var jobNumbers = yearSheet.getRange("B2:B" + lastRow).getValues();
      
      // Find the row for this job number
      for (var i = 0; i < jobNumbers.length; i++) {
        if (jobNumbers[i][0] === jobNumber) {
          var row = i + 2; // +2 because we start from row 2
          var aaValue = yearSheet.getRange(row, 27).getValue(); // Column AA
          var aaValueStr = String(aaValue || "").trim();
          
          // Check if AA column contains "Drew" (case-insensitive)
          if (aaValueStr.toLowerCase() === "drew" || aaValueStr.toLowerCase().indexOf("drew") !== -1) {
            var drewExists = getCommissionDataValue(jobNumber, "Drew", "K");
            if (drewExists === null) {
              var drewPaidAmount = getPaidAmountFromTotalCommissions(jobNumber, "Drew", year);
              updateCommissionData(jobNumber, "Drew", drewPaidAmount, 0, false, false);
              Logger.log("Added Drew's commission entry for 2026 Job: " + jobNumber + " based on AA column value: " + aaValueStr);
            }
          }
          break;
        }
      }
    }
  }
}

// Get value from Commission Data sheet
function getCommissionDataValue(jobNumber, salesperson, column) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = spreadsheet.getSheetByName("Commission Data");
  if (!dataSheet) {
    Logger.log("Commission Data sheet not found");
    return null;
  }

  var lastRow = dataSheet.getLastRow();
  if (lastRow < 2) return null;

  var data = dataSheet.getRange("A2:F" + lastRow).getValues();
  
  for (var i = 0; i < data.length; i++) {
    if (data[i][1] === jobNumber && data[i][2] === salesperson) {
      // Found the row (leadNumber, jobNumber, salesperson, paid, owed, override)
      if (column === "Lead") return data[i][0];
      if (column === "J") return data[i][3]; // Paid
      if (column === "K") return data[i][4]; // Owed
      if (column === "L") return data[i][5]; // Override
    }
  }
  
  return null;
}

// Update Commission Data sheet (onlyUpdateExisting: if true, don't create new entries)
function updateCommissionData(jobNumber, salesperson, jValue, kValue, lValue, onlyUpdateExisting) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = spreadsheet.getSheetByName("Commission Data");
  if (!dataSheet) {
    if (onlyUpdateExisting) {
      Logger.log("Commission Data sheet not found and onlyUpdateExisting is true. Skipping.");
      return;
    }
    Logger.log("Commission Data sheet not found. Creating it...");
    dataSheet = spreadsheet.insertSheet("Commission Data");
    dataSheet.getRange("A1:F1").setValues([["Lead Number", "Job Number", "Salesperson", "Paid", "Owed", "Override"]]);
  }

  var lastRow = dataSheet.getLastRow();
  var data = lastRow > 1 ? dataSheet.getRange("A2:F" + lastRow).getValues() : [];
  
  var foundRow = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i][1] === jobNumber && data[i][2] === salesperson) {
      foundRow = i + 2; // +2 because row 1 is header and array is 0-indexed
      break;
    }
  }

  if (foundRow === -1) {
    if (onlyUpdateExisting) {
      Logger.log("Entry not found for Job: " + jobNumber + ", Salesperson: " + salesperson + ". onlyUpdateExisting is true, skipping.");
      return;
    }
    
    // New entry - append to bottom (need to get lead number from year sheet)
    // Try 2025 first, then 2026
    var yearSheet = spreadsheet.getSheetByName("2025") || spreadsheet.getSheetByName("2026");
    var leadNumber = "";
    if (yearSheet) {
      var lastRowYear = yearSheet.getLastRow();
      var jobNumbersYear = yearSheet.getRange("B2:B" + lastRowYear).getValues();
      var leadNumbersYear = yearSheet.getRange("A2:A" + lastRowYear).getValues();
      for (var i = 0; i < jobNumbersYear.length; i++) {
        if (jobNumbersYear[i][0] === jobNumber) {
          leadNumber = leadNumbersYear[i][0];
          break;
        }
      }
    }
    
    foundRow = lastRow + 1;
    dataSheet.getRange(foundRow, 1, 1, 6).setValues([[
      leadNumber,
      jobNumber,
      salesperson,
      jValue !== null ? jValue : 0,
      kValue !== null ? kValue : 0,
      lValue !== null ? lValue : false
    ]]);
    Logger.log("Created new entry in Commission Data for Job: " + jobNumber + ", Salesperson: " + salesperson);
  } else {
    // Update existing row (columns shifted: A=Lead, B=Job, C=Salesperson, D=Paid, E=Owed, F=Override)
    if (jValue !== null) dataSheet.getRange(foundRow, 4).setValue(jValue); // Column D
    if (kValue !== null) dataSheet.getRange(foundRow, 5).setValue(kValue); // Column E
    if (lValue !== null) dataSheet.getRange(foundRow, 6).setValue(lValue); // Column F
    Logger.log("Updated existing Commission Data for Job: " + jobNumber + ", Salesperson: " + salesperson);
  }
}

// Fallback time based function to check S flag that moved to T
function checkForSTrue() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  // Check both 2025 and 2026 sheets
  var sheetsToCheck = ["2025", "2026"];
  
  sheetsToCheck.forEach(function(year) {
    var sheet = spreadsheet.getSheetByName(year);
    if (!sheet) {
      Logger.log("Sheet " + year + " not found in time based check.");
      return;
    }

    var lastRow = sheet.getLastRow();
    var tRange = sheet.getRange("T1:T" + lastRow); // T now holds prior S flag
    var tValues = tRange.getValues();

    for (var i = 0; i < tValues.length; i++) {
      if (tValues[i][0] === true) {
        var row = i + 1;
        Logger.log("Found T TRUE at row " + row + " in " + year + " sheet in time based check.");
        processCommissionUpdate(sheet, row, year);
      }
    }
  });
}

// Create fresh triggers
function createTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var funcName = triggers[i].getHandlerFunction();
    if (funcName === "onEditInstalled" || funcName === "syncPaidAmountsFromTotalCommissions" || funcName === "reHighlightRows" || funcName === "syncCommissionData") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("onEditInstalled")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  
  // Optional: Sync paid amounts from Total Commissions every hour
  // Uncomment the lines below to enable automatic syncing
  ScriptApp.newTrigger("syncPaidAmountsFromTotalCommissions")
    .timeBased()
    .everyHours(1)
    .create();

  // Time-based trigger to re-highlight rows every 10 minutes (catches Zapier updates)
  ScriptApp.newTrigger("reHighlightRows")
    .timeBased()
    .everyMinutes(10)
    .create();

  // Time-based trigger to sync Commission Data every 15 minutes
  ScriptApp.newTrigger("syncCommissionData")
    .timeBased()
    .everyMinutes(15)
    .create();

}

// Re color all rows with the new rules
function reHighlightRows() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetsToProcess = ["2025", "2026"];
  var totalProcessed = 0;
  var totalSkipped = 0;
  var totalErrors = 0;
  
  try {
    sheetsToProcess.forEach(function(year) {
      var sheet = spreadsheet.getSheetByName(year);
      if (!sheet) {
        Logger.log("Sheet '" + year + "' not found, skipping");
        return;
      }

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        Logger.log("Sheet '" + year + "' has no data rows, skipping");
        return;
      }

      // Read column A in batch to identify which rows to process
      var columnA = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      
      // Build list of rows to process (only non-blank)
      var rowsToProcess = [];
      for (var i = 0; i < columnA.length; i++) {
        var colAValue = columnA[i][0];
        if (colAValue && String(colAValue).trim() !== "") {
          rowsToProcess.push(i + 2); // Store 1-based row number (offset by header row)
        } else {
          totalSkipped++;
        }
      }
      
      Logger.log("Sheet '" + year + "': Found " + rowsToProcess.length + " rows with data (skipping " + totalSkipped + " blank rows)");
      
      if (rowsToProcess.length === 0) {
        Logger.log("No rows to process for sheet '" + year + "'");
        return; // Return from forEach callback, not continue
      }
      
      // Batch read all columns we need: F (6), O (15), S (19), U (21)
      var minRow = Math.min.apply(null, rowsToProcess);
      var maxRow = Math.max.apply(null, rowsToProcess);
      var fValues = sheet.getRange(minRow, 6, maxRow - minRow + 1, 1).getValues();  // Column F
      var oValues = sheet.getRange(minRow, 15, maxRow - minRow + 1, 1).getValues(); // Column O
      var sValues = sheet.getRange(minRow, 19, maxRow - minRow + 1, 1).getValues(); // Column S
      var uValues = sheet.getRange(minRow, 21, maxRow - minRow + 1, 1).getValues(); // Column U
      
      // Process rows and collect background colors
      var colorsToSet = [];
      for (var j = 0; j < rowsToProcess.length; j++) {
        var row = rowsToProcess[j];
        var arrayIndex = row - minRow; // Convert to array index
        
        try {
          var sVal = sValues[arrayIndex][0];
          var uVal = uValues[arrayIndex][0];
          var oRaw = oValues[arrayIndex][0];
          var fVal = Number(fValues[arrayIndex][0]) || 0;
          
          var oPct = asPercentNumber(oRaw);
          var inBilling = String(uVal || "").trim().toLowerCase() === "in billing";
          var active = sVal === true && inBilling;
          
          var color = null;
          if (active) {
            if (isFinite(oPct) && oPct < 32) {
              color = COLOR_ROW_RED;
            } else if ((isFinite(oPct) && oPct < 50) || fVal < 5000) {
              color = COLOR_ROW_YELLOW;
            } else if ((isFinite(oPct) && oPct >= 50 && oPct < 60) && fVal > 5000) {
              color = COLOR_ROW_BLUE;
            } else if ((isFinite(oPct) && oPct >= 60) && fVal > 5000) {
              color = COLOR_ROW_GREEN;
            }
          }
          
          colorsToSet.push({row: row, color: color});
          totalProcessed++;
        } catch (err) {
          totalErrors++;
          Logger.log("Error processing row " + row + " in sheet '" + year + "': " + err);
        }
      }
      
      // Batch update backgrounds
      for (var k = 0; k < colorsToSet.length; k++) {
        var item = colorsToSet[k];
        var rowRange = sheet.getRange(item.row, 1, 1, 22); // A through V
        rowRange.setBackground(item.color || null);
      }
      
      // Final flush for this sheet
      SpreadsheetApp.flush();
    });
    
    Logger.log("Re-highlighting complete. Processed: " + totalProcessed + " rows, Skipped: " + totalSkipped + ", Errors: " + totalErrors);
    // Show completion message if run manually (not from time trigger)
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "Highlighting complete: " + totalProcessed + " rows processed" + 
        (totalSkipped > 0 ? ", " + totalSkipped + " blank rows skipped" : "") +
        (totalErrors > 0 ? " (" + totalErrors + " errors)" : ""),
        "Re Highlight Rows",
        3
      );
    } catch (e) {
      // Toast might not be available in all contexts, ignore
    }
  } catch (err) {
    Logger.log("Error in reHighlightRows: " + err);
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast("Error during highlighting: " + err, "Re Highlight Rows", 5);
    } catch (e) {
      // Ignore toast errors
    }
  }
}

// Sync Commission Data from 2025/2026 sheets
function syncCommissionData() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var commissionDataSheet = spreadsheet.getSheetByName("Commission Data");
  
  if (!commissionDataSheet) {
    Logger.log("Commission Data sheet not found. Creating it...");
    commissionDataSheet = spreadsheet.insertSheet("Commission Data");
    commissionDataSheet.getRange("A1:F1").setValues([["Lead Number", "Job Number", "Salesperson", "Paid", "Owed", "Override"]]);
  }
  
  // Get existing commission data (to preserve entries not in 2025/2026 sheets)
  var dataLastRow = commissionDataSheet.getLastRow();
  var existingData = dataLastRow > 1 ? commissionDataSheet.getRange("A2:F" + dataLastRow).getValues() : [];
  var existingMap = {};
  
  existingData.forEach(function(row, index) {
    var key = String(row[1] || "").trim() + "|" + String(row[2] || "").trim(); // jobNumber|salesperson (trim so F preserved on lookup)
    existingMap[key] = {
      leadNumber: row[0],
      paid: row[3],
      owed: row[4],
      override: row[5]
    };
  });
  
  var allRows = [];
  
  // Process 2025 sheet
  var sheet2025 = spreadsheet.getSheetByName("2025");
  if (sheet2025) {
    var rows2025 = syncCommissionDataForYear(sheet2025, "2025", existingMap);
    if (rows2025 && rows2025.length > 0) {
      allRows = allRows.concat(rows2025);
    }
  }
  
  // Process 2026 sheet
  var sheet2026 = spreadsheet.getSheetByName("2026");
  if (sheet2026) {
    var rows2026 = syncCommissionDataForYear(sheet2026, "2026", existingMap);
    if (rows2026 && rows2026.length > 0) {
      allRows = allRows.concat(rows2026);
    }
  }
  
  // Add any remaining entries from existingMap that weren't processed
  for (var key in existingMap) {
    var parts = key.split("|");
    allRows.push([
      existingMap[key].leadNumber,
      parts[0], // jobNumber
      parts[1], // salesperson
      existingMap[key].paid,
      existingMap[key].owed,
      existingMap[key].override
    ]);
  }
  
  // Write data in a single batch operation for better performance
  if (allRows.length > 0) {
    // Clear existing data first
    if (dataLastRow > 1) {
      commissionDataSheet.getRange("A2:F" + dataLastRow).clearContent();
    }
    // Write all data in one operation
    commissionDataSheet.getRange(2, 1, allRows.length, 6).setValues(allRows);
    Logger.log("Synced " + allRows.length + " total rows to Commission Data");
  } else {
    // If no rows, just clear the data area
    if (dataLastRow > 1) {
      commissionDataSheet.getRange("A2:F" + dataLastRow).clearContent();
    }
  }
  
  Logger.log("Commission Data sync complete");
}

// Helper function to sync Commission Data for a specific year
function syncCommissionDataForYear(yearSheet, year, existingMap) {
  var lastRow = yearSheet.getLastRow();
  if (lastRow < 2) return [];
  
  // Batch read all needed columns in one operation for better performance
  // Read columns A, B, I, and AA (if 2026) in a single batch
  var allData;
  
  if (year === "2026") {
    // For 2026, read A, B, I, and AA columns
    allData = yearSheet.getRange(2, 1, lastRow - 1, 27).getValues(); // A to AA (columns 1-27)
  } else {
    // For 2025, read A, B, I columns only
    allData = yearSheet.getRange(2, 1, lastRow - 1, 9).getValues(); // A to I (columns 1-9)
  }
  
  var validSalespeople2025 = ["Brett", "Drew", "James", "Geoff", "Will"];
  var validSalespeople2026 = ["Brett", "Drew", "James", "Mike"];
  var validSalespeople = year === "2025" ? validSalespeople2025 : validSalespeople2026;
  
  var allRows = [];
  
  for (var i = 0; i < allData.length; i++) {
    var leadNumber = allData[i][0];      // Column A
    var jobNumber = allData[i][1];       // Column B
    var salesperson = allData[i][8];     // Column I
    var aaValue = year === "2026" ? allData[i][26] : null; // Column AA for 2026
    
    if (!jobNumber) continue;
    
    var leadNum = parseInt(leadNumber, 10) || 0;
    var jobNumTrim = String(jobNumber).trim();
    var salespersonTrim = String(salesperson).trim();
    var isValidSalesperson = validSalespeople.indexOf(salesperson) !== -1;

    if (isValidSalesperson) {
      // Entry for the actual salesperson (trimmed key so we match existingMap and preserve Override F)
      var key = jobNumTrim + "|" + salespersonTrim;
      if (!existingMap[key]) {
        // New entry - set paid amount to 0 (will be updated by syncPaidAmountsFromTotalCommissions if needed)
        // This avoids timeout issues from calling getPaidAmountFromTotalCommissions for every new entry
        allRows.push([leadNumber, jobNumber, salesperson, 0, 0, false]);
      } else {
        // Existing entry - preserve in same order
        var existing = existingMap[key];
        allRows.push([leadNumber, jobNumber, salesperson, existing.paid, existing.owed, existing.override]);
        delete existingMap[key]; // Mark as processed
      }
    }
    
    // For 2025: leads > 1857, also add Drew's sales manager commission (if he's not the salesperson).
    // Run independently of base salesperson validity so Drew is still included.
    if (year === "2025" && leadNum > 1857 && salesperson !== "Drew") {
      var drewKey = jobNumTrim + "|Drew";
      
      if (!existingMap[drewKey]) {
        // New Drew entry - set paid amount to 0 (will be updated by syncPaidAmountsFromTotalCommissions if needed)
        allRows.push([leadNumber, jobNumber, "Drew", 0, 0, false]);
      } else {
        // Existing Drew entry - preserve
        var drewExisting = existingMap[drewKey];
        allRows.push([leadNumber, jobNumber, "Drew", drewExisting.paid, drewExisting.owed, drewExisting.override]);
        delete existingMap[drewKey]; // Mark as processed
      }
    }
    
    // For 2026: also add Drew's entry if he's listed in column AA (column 27)
    if (year === "2026" && salesperson !== "Drew" && aaValue !== null) {
      var aaValueStr = String(aaValue || "").trim();
      
      // Check if AA column contains "Drew" (case-insensitive)
      if (aaValueStr.toLowerCase() === "drew" || aaValueStr.toLowerCase().indexOf("drew") !== -1) {
        var drewKey = jobNumTrim + "|Drew";
        
        if (!existingMap[drewKey]) {
          // New Drew entry - set paid amount to 0 (will be updated by syncPaidAmountsFromTotalCommissions if needed)
          allRows.push([leadNumber, jobNumber, "Drew", 0, 0, false]);
        } else {
          // Existing Drew entry - preserve
          var drewExisting = existingMap[drewKey];
          allRows.push([leadNumber, jobNumber, "Drew", drewExisting.paid, drewExisting.owed, drewExisting.override]);
          delete existingMap[drewKey]; // Mark as processed
        }
      }
    }
  }
  
  Logger.log("Collected " + allRows.length + " rows from " + year + " sheet for Commission Data sync");
  
  return allRows;
}

// Get paid amount from Total Commissions sheet in commissions spreadsheet
function getPaidAmountFromTotalCommissions(jobNumber, salesperson, year) {
  var commissionsSpreadsheetId = "19d5c8TpaUh9r5Bzw4Rh6zATcAsrS480NExlaS_tYMJs";
  
  // Default to 2025 if year not provided (for backward compatibility and immediate data recovery)
  if (!year) {
    year = "2025";
  }
  
  try {
    var commissionsSpreadsheet = SpreadsheetApp.openById(commissionsSpreadsheetId);
    var totalCommissionsSheetName = "Total Commissions " + year;
    var totalCommissionsSheet = commissionsSpreadsheet.getSheetByName(totalCommissionsSheetName);
    
    if (!totalCommissionsSheet) {
      Logger.log("Sheet '" + totalCommissionsSheetName + "' not found");
      return 0;
    }
    
    // Column mapping for salesperson in Total Commissions (year-specific)
    var columnMap;
    if (year === "2025") {
      columnMap = {
        "Brett": 2,   // Column B
        "Drew": 3,    // Column C
        "James": 4,   // Column D
        "Geoff": 5,   // Column E
        "Will": 6     // Column F
      };
    } else if (year === "2026") {
      columnMap = {
        "Brett": 2,   // Column B
        "Drew": 3,    // Column C
        "James": 4,   // Column D
        "Mike": 5     // Column E
      };
    }
    
    var column = columnMap ? columnMap[salesperson] : null;
    if (!column) return 0;
    
    var lastRow = totalCommissionsSheet.getLastRow();
    var data = totalCommissionsSheet.getRange(2, column, lastRow - 1, 1).getValues();
    
    var totalPaid = 0;
    
    for (var i = 0; i < data.length; i++) {
      var cellContent = String(data[i][0]).trim();
      
      if (!cellContent) continue;
      
      // Handle different job number formats
      var jobNumStr = String(jobNumber).trim();
      
      // Match job number at start of line or after newline
      var jobPattern = new RegExp("(^|\\n)" + jobNumStr + "\\s*-", "gm");
      
      if (jobPattern.test(cellContent)) {
        // Split by lines to find all instances
        var lines = cellContent.split(/\n/);
        for (var j = 0; j < lines.length; j++) {
          if (lines[j].indexOf(jobNumStr) !== -1) {
            // Extract dollar amount from this line
            var match = lines[j].match(/\$([0-9,]+\.?\d*)/);
            if (match) {
              var amount = parseFloat(match[1].replace(/,/g, ""));
              if (!isNaN(amount)) {
                totalPaid += amount;
                Logger.log("Found payment for " + jobNumber + ": $" + amount + " in: " + lines[j]);
              }
            }
          }
        }
      }
    }
    
    Logger.log("Total paid for " + jobNumber + " (" + salesperson + "): $" + totalPaid);
    
    return totalPaid;
  } catch (error) {
    Logger.log("Error accessing Total Commissions " + year + ": " + error.toString());
    return 0;
  }
}

// Test function to debug Total Commissions lookup
function testTotalCommissionsLookup() {
  var testJobNumber = "20255001"; // Change this to test different job numbers
  var testSalesperson = "Adam"; // Change this to test different salespeople
  
  Logger.log("Testing lookup for Job: " + testJobNumber + ", Salesperson: " + testSalesperson);
  var result = getPaidAmountFromTotalCommissions(testJobNumber, testSalesperson, "2025");
  Logger.log("Result: $" + result);
  
  SpreadsheetApp.getUi().alert("Test complete. Check View > Logs for details.\n\nJob: " + testJobNumber + "\nSalesperson: " + testSalesperson + "\nTotal Paid: $" + result);
}

// Sync paid amounts from Total Commissions to Commission Data
function syncPaidAmountsFromTotalCommissions() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var commissionDataSheet = spreadsheet.getSheetByName("Commission Data");
  
  if (!commissionDataSheet) {
    SpreadsheetApp.getUi().alert("Commission Data sheet not found.");
    return;
  }
  
  var lastRow = commissionDataSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No data in Commission Data sheet.");
    return;
  }
  
  var data = commissionDataSheet.getRange("A2:F" + lastRow).getValues();
  var updatedCount = 0;
  
  for (var i = 0; i < data.length; i++) {
    var leadNumber = data[i][0];
    var jobNumber = data[i][1];
    var salesperson = data[i][2];
    var currentPaid = data[i][3];
    
    // Get updated paid amount from the correct yearly Total Commissions sheet.
    var year = detectCommissionYear(leadNumber, jobNumber, salesperson);
    var newPaid = getPaidAmountFromTotalCommissions(jobNumber, salesperson, year);
    
    // Only update if amount changed
    if (newPaid !== currentPaid) {
      commissionDataSheet.getRange(i + 2, 4).setValue(newPaid); // Column D (Paid)
      updatedCount++;
      Logger.log("Updated paid amount for Job: " + jobNumber + ", " + salesperson + ": " + currentPaid + " → " + newPaid);
    }
  }
  
  SpreadsheetApp.getUi().alert("Sync complete. Updated " + updatedCount + " paid amounts from Total Commissions.");
  Logger.log("Sync paid amounts complete. Updated " + updatedCount + " entries.");
}

// Recalculate owed amounts in Commission Data using proper commission calculation
function recalculateOwedAmounts() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var commissionDataSheet = spreadsheet.getSheetByName("Commission Data");
  var sheet2025 = spreadsheet.getSheetByName("2025");
  
  if (!commissionDataSheet) {
    SpreadsheetApp.getUi().alert("Commission Data sheet not found.");
    return;
  }
  
  if (!sheet2025) {
    SpreadsheetApp.getUi().alert("2025 sheet not found.");
    return;
  }
  
  var lastRow = commissionDataSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No data in Commission Data sheet.");
    return;
  }
  
  // Get job data from 2025 sheet
  var sheet2025LastRow = sheet2025.getLastRow();
  var jobDataMap = {};
  if (sheet2025LastRow >= 2) {
    var jobIds2025 = sheet2025.getRange("A2:A" + sheet2025LastRow).getValues();
    var jobNumbers2025 = sheet2025.getRange("B2:B" + sheet2025LastRow).getValues();
    var kValues2025 = sheet2025.getRange("K2:K" + sheet2025LastRow).getValues();
    var salespeople2025 = sheet2025.getRange("I2:I" + sheet2025LastRow).getValues();
    
    for (var j = 0; j < jobNumbers2025.length; j++) {
      var jobNum = jobNumbers2025[j][0];
      var salesperson2025 = salespeople2025[j][0];
      var jobId = jobIds2025[j][0];
      var kValue = kValues2025[j][0];
      kValue = (typeof kValue === "number" && !isNaN(kValue)) ? kValue : (typeof kValue === "string" ? parseFloat(kValue.replace(/[^0-9.-]+/g, "")) || 0 : 0);
      
      if (jobNum && salesperson2025) {
        var key = jobNum + "|" + salesperson2025;
        jobDataMap[key] = {
          jobId: jobId,
          totalValue: kValue,
          salesperson: salesperson2025
        };
      }
    }
  }
  
  var data = commissionDataSheet.getRange("A2:F" + lastRow).getValues();
  var updatedCount = 0;
  
  for (var i = 0; i < data.length; i++) {
    var leadNumber = data[i][0];
    var jobNumber = data[i][1];
    var salesperson = data[i][2];
    var paidAmount = data[i][3];
    var currentOwed = data[i][4];
    var override = data[i][5]; // Column F - skip recalc when TRUE
    if (override === true) continue;

    var key = jobNumber + "|" + salesperson;
    var jobData = jobDataMap[key];
    
    if (!jobData) {
      Logger.log("No job data found for " + jobNumber + ", " + salesperson);
      continue;
    }
    
    var jobIdNum = parseInt(jobData.jobId, 10) || 0;
    var totalValue = jobData.totalValue;
    var leadNum = parseInt(leadNumber, 10) || 0;
    
    // Calculate commission rate using the same logic as processCommissionUpdate
    var commissionRate;
    if (salesperson === "Drew") {
      commissionRate = leadNum > 1857 ? 0.01 : 0.05;
    } else if (salesperson === "Geoff") {
      commissionRate = jobIdNum > 1749 ? 0.05 : 0.00;
    } else if (salesperson === "James") {
      commissionRate = getJames2025CommissionRate(jobIdNum);
    } else {
      commissionRate = 0.05; // Brett and others: 5%
    }
    
    var totalCommission = totalValue * commissionRate;
    var newOwed = Math.max(0, totalCommission - paidAmount);
    // James 2025 at 10.5%: do not create new owed on jobs already fully paid at old rate (4% or 10%)
    if (salesperson === "James" && commissionRate === 0.105) {
      var oldRateJames = jobIdNum < 1203 ? 0.04 : 0.10;
      if (paidAmount >= oldRateJames * totalValue - 0.01) newOwed = 0;
    }
    newOwed = Math.round(newOwed * 100) / 100; // Round to 2 decimal places
    
    // Update if changed
    if (Math.abs(newOwed - currentOwed) > 0.01) {
      commissionDataSheet.getRange(i + 2, 5).setValue(newOwed); // Column E (Owed)
      updatedCount++;
      Logger.log("Recalculated owed for Job: " + jobNumber + ", " + salesperson + ": " + currentOwed + " → " + newOwed + " (Total Comm: " + totalCommission + ", Paid: " + paidAmount + ")");
    }
  }
  
  SpreadsheetApp.getUi().alert("Recalculation complete. Updated " + updatedCount + " owed amounts.");
  Logger.log("Recalculate owed amounts complete. Updated " + updatedCount + " entries.");
}

// Create or update Index sheet with clickable links to all sheets organized by year
function createOrUpdateIndexSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var allSheets = spreadsheet.getSheets();
  
  // Group sheets by year
  var sheetsByYear = {
    "2024": [],
    "2025": [],
    "2026": [],
    "Other": []
  };
  
  // Process all sheets and group by year
  for (var i = 0; i < allSheets.length; i++) {
    var sheet = allSheets[i];
    var sheetName = sheet.getName();
    
    // Skip the Index sheet itself
    if (sheetName === "Index") {
      continue;
    }
    
    var sheetInfo = {
      name: sheetName,
      id: sheet.getSheetId()
    };
    
    // Extract year from sheet name
    var year = extractYearFromSheetName(sheetName);
    if (year && sheetsByYear.hasOwnProperty(year)) {
      sheetsByYear[year].push(sheetInfo);
    } else {
      sheetsByYear["Other"].push(sheetInfo);
    }
  }
  
  // Sort sheets within each year group alphabetically
  for (var yearKey in sheetsByYear) {
    sheetsByYear[yearKey].sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
  }
  
  // Get or create Index sheet
  var indexSheet = spreadsheet.getSheetByName("Index");
  if (!indexSheet) {
    indexSheet = spreadsheet.insertSheet("Index");
  } else {
    // Clear existing content
    indexSheet.clear();
  }
  
  // Set up headers - newest year on left, oldest on right
  var years = ["2026", "2025", "2024", "Other"];
  var headerRange = indexSheet.getRange(1, 1, 1, years.length);
  headerRange.setValues([years]);
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");
  
  // Find the maximum number of sheets in any year group
  var maxSheets = 0;
  for (var j = 0; j < years.length; j++) {
    if (sheetsByYear[years[j]].length > maxSheets) {
      maxSheets = sheetsByYear[years[j]].length;
    }
  }
  
  // Populate sheet names with HYPERLINK formulas
  // Note: Google Sheets HYPERLINK requires two clicks, but this is the most reliable method
  if (maxSheets > 0) {
    var formulas = [];
    for (var row = 0; row < maxSheets; row++) {
      var rowFormulas = [];
      for (var col = 0; col < years.length; col++) {
        var year = years[col];
        var sheetList = sheetsByYear[year];
        
        if (row < sheetList.length) {
          var sheetInfo = sheetList[row];
          // Use HYPERLINK formula - requires two clicks but is the standard Google Sheets method
          var formula = '=HYPERLINK("#gid=' + sheetInfo.id + '","' + sheetInfo.name.replace(/"/g, '""') + '")';
          rowFormulas.push(formula);
        } else {
          rowFormulas.push("");
        }
      }
      formulas.push(rowFormulas);
    }
    
    if (formulas.length > 0) {
      var dataRange = indexSheet.getRange(2, 1, formulas.length, years.length);
      dataRange.setFormulas(formulas);
      dataRange.setHorizontalAlignment("left");
    }
  }
  
  // Set column widths
  for (var k = 1; k <= years.length; k++) {
    indexSheet.setColumnWidth(k, 200);
  }
  
  // Freeze header row
  indexSheet.setFrozenRows(1);
  
  Logger.log("Index sheet created/updated successfully");
}

// Helper function to extract year from sheet name
function extractYearFromSheetName(sheetName) {
  // Check for direct year match (2024, 2025, 2026)
  if (sheetName === "2024" || sheetName === "2025" || sheetName === "2026") {
    return sheetName;
  }
  
  // Check for pattern like "2025 Brett", "2026 Drew", etc.
  var yearMatch = sheetName.match(/^(202[4-6])\s/);
  if (yearMatch) {
    return yearMatch[1];
  }
  
  // Check if sheet name starts with year
  if (sheetName.indexOf("2024") === 0 || sheetName.indexOf("2025") === 0 || sheetName.indexOf("2026") === 0) {
    return sheetName.substring(0, 4);
  }
  
  return null;
}

// Helper function to parse month from various formats
function parseMonthInput(monthInput) {
  if (!monthInput || monthInput === "") {
    // Default to current month
    var now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1 // JavaScript months are 0-indexed
    };
  }
  
  var input = String(monthInput).trim();
  
  // Try parsing as date
  var date = new Date(input);
  if (!isNaN(date.getTime())) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1
    };
  }
  
  // Try parsing as YYYY-MM format
  var yyyyMM = input.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (yyyyMM) {
    return {
      year: parseInt(yyyyMM[1]),
      month: parseInt(yyyyMM[2])
    };
  }
  
  // Try parsing as MM/YYYY format
  var mmYYYY = input.match(/^(\d{1,2})[-\/](\d{4})$/);
  if (mmYYYY) {
    return {
      year: parseInt(mmYYYY[2]),
      month: parseInt(mmYYYY[1])
    };
  }
  
  // Default to current month if parsing fails
  var now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
}

// Update Paid 2026 sheet with jobs paid in the selected month
function updatePaid2026Sheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get or create Paid 2026 sheet
  var paidSheet = spreadsheet.getSheetByName("Paid 2026");
  if (!paidSheet) {
    paidSheet = spreadsheet.insertSheet("Paid 2026");
  }
  
  // Clear existing data (keep header row area)
  var lastRow = paidSheet.getLastRow();
  if (lastRow > 2) {
    paidSheet.getRange(3, 1, lastRow - 2, 9).clear();
  }
  
  // Get month selection from A1, default to current month
  var monthInput = paidSheet.getRange("A1").getValue();
  var monthInfo = parseMonthInput(monthInput);
  
  // Set up header row
  var headers = ["Job Number", "Name", "Contract Amount", "Change Orders", "Invoiced Total", "Cost", "GP", "GP %", "Paid in Full"];
  paidSheet.getRange(2, 1, 1, headers.length).setValues([headers]);
  paidSheet.getRange(2, 1, 1, headers.length).setFontWeight("bold");
  
  // Add label for month selector
  if (!paidSheet.getRange("A1").getValue()) {
    paidSheet.getRange("A1").setValue("Month (YYYY-MM or leave blank for current month)");
    paidSheet.getRange("A1").setFontStyle("italic");
    paidSheet.getRange("A1").setFontColor("#666666");
  }
  
  // Collect all paid jobs from year sheets
  var allPaidJobs = [];
  var yearSheets = ["2024", "2025", "2026"];
  
  for (var i = 0; i < yearSheets.length; i++) {
    var yearSheet = spreadsheet.getSheetByName(yearSheets[i]);
    if (!yearSheet) {
      continue;
    }
    
    var lastRow = yearSheet.getLastRow();
    if (lastRow < 2) {
      continue;
    }
    
    // Read all needed columns in a single batch operation for better performance
    // Read columns B, C, F, J, L, M, N, O, S, and AC in one go
    // We'll read a contiguous range and then extract what we need
    // Strategy: Read B:AC (columns 2-29) which includes all our needed columns
    var allData = yearSheet.getRange(2, 2, lastRow - 1, 28).getValues(); // B to AC (columns 2-29)
    
    // Process each row
    for (var j = 0; j < allData.length; j++) {
      // Extract paid date from AC column (index 27 in our array: 29-2=27)
      var paidDate = allData[j][27];
      
      // Skip if no paid date
      if (!paidDate || paidDate === "") {
        continue;
      }
      
      // Convert to Date object if it's not already
      var dateObj = paidDate instanceof Date ? paidDate : new Date(paidDate);
      
      // Check if date is valid and matches the selected month
      if (isNaN(dateObj.getTime())) {
        continue;
      }
      
      var paidYear = dateObj.getFullYear();
      var paidMonth = dateObj.getMonth() + 1; // JavaScript months are 0-indexed
      
      // Check if this job was paid in the selected month
      if (paidYear === monthInfo.year && paidMonth === monthInfo.month) {
        // Extract the data for this row from the batch read
        // Column indices in our array (0-based, relative to column B):
        // B = 0, C = 1, F = 4, J = 8, L = 10, M = 11, N = 12, O = 13, S = 17
        var jobData = [
          allData[j][0] || "",  // B - Job Number
          allData[j][1] || "",  // C - Name
          allData[j][4] || "",  // F - Contract Amount
          allData[j][10] || "", // L - Change Orders
          allData[j][8] || "",  // J - Invoiced Total
          allData[j][11] || "", // M - Cost
          allData[j][12] || "", // N - GP
          allData[j][13] || "", // O - GP %
          allData[j][17] || ""  // S - Paid in Full
        ];
        
        allPaidJobs.push(jobData);
      }
    }
  }
  
  // Sort by job number (or you could sort by date paid if preferred)
  allPaidJobs.sort(function(a, b) {
    var jobA = String(a[0] || "").toLowerCase();
    var jobB = String(b[0] || "").toLowerCase();
    return jobA.localeCompare(jobB);
  });
  
  // Write data to Paid 2026 sheet
  if (allPaidJobs.length > 0) {
    paidSheet.getRange(3, 1, allPaidJobs.length, headers.length).setValues(allPaidJobs);
  }
  
  // Format the sheet
  paidSheet.setFrozenRows(2);
  paidSheet.autoResizeColumns(1, headers.length);
  
  Logger.log("Paid 2026 sheet updated with " + allPaidJobs.length + " jobs for " + monthInfo.year + "-" + monthInfo.month);
}

// Custom menu
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Custom Actions')
    .addItem('Re Highlight Rows', 'reHighlightRows')
    .addItem('Sync Commission Data', 'syncCommissionData')
    .addItem('Sync Paid Amounts', 'syncPaidAmountsFromTotalCommissions')
    .addItem('Recalculate Owed Amounts', 'recalculateOwedAmounts')
    .addItem('Test Payment Lookup', 'testTotalCommissionsLookup')
    .addSeparator()
    .addItem('Refresh Index', 'createOrUpdateIndexSheet')
    .addItem('Update Paid 2026', 'updatePaid2026Sheet')
    .addToUi();
  
  // Auto-update index sheet on open
  createOrUpdateIndexSheet();
  
  // Auto-update Paid 2026 sheet on open
  updatePaid2026Sheet();
  
  // Auto-sync Commission Data on open
  syncCommissionData();
}

