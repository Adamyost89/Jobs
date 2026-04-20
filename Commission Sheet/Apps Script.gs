function onEditTrigger(e) {
  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = sheet.getName();
  var dataColumn = range.getColumn();

  // Parse sheet name to extract salesman and year (format: "Salesman Year" or "Salesman")
  var sheetNameMatch = sheetName.match(/^(.+?)\s+(\d{4})$/);
  var salesman = sheetNameMatch ? sheetNameMatch[1] : sheetName;
  var year = sheetNameMatch ? sheetNameMatch[2] : "2025"; // Default to 2025 if no year in name
  
  // Build target sheet name (format: "Year Salesman")
  var targetSheetName = year + " " + salesman;
  
  // Valid salesmen for 2025 and 2026
  var validSalesmen2025 = ["Brett", "Drew", "James", "Geoff", "Adam"];
  var validSalesmen2026 = ["Brett", "Drew", "James", "Mike"];
  var validSalesmen = year === "2025" ? validSalesmen2025 : validSalesmen2026;

  // Check if edit is in column L (12) on a valid salesman sheet
  if (validSalesmen.indexOf(salesman) !== -1 && dataColumn === 12) {
    Logger.log("L column edited on " + sheetName);

    // Get the specific row that was edited
    var editedRow = range.getRow();
    
    // Only process if the checkbox was checked (set to TRUE)
    var checkboxValue = range.getValue();
    if (checkboxValue !== true) {
      Logger.log("Checkbox unchecked or not TRUE, skipping processing");
      return;
    }

    var targetSpreadsheetId = "1eO365hmI2Nm9_YssKGka92teOkoRD0uzSnM0r31D7ek";
    var targetSpreadsheet;
    try {
      targetSpreadsheet = SpreadsheetApp.openById(targetSpreadsheetId);
      Logger.log("Successfully opened target spreadsheet: " + targetSpreadsheetId);
    } catch (error) {
      Logger.log("Error opening target spreadsheet: " + error.toString());
      return; // Don't revert L
    }

    // Process only the edited row
    try {
      processPayment(sheet, editedRow, sheetName, targetSpreadsheet, salesman, year, targetSheetName);
    } catch (error) {
      Logger.log("Error processing payment for row " + editedRow + " on " + sheetName + ": " + error.toString());
    }
  }

  // Highlighting logic (runs on any edit in any sheet)
  try {
    highlightRows();
  } catch (error) {
    Logger.log("Error in highlightRows: " + error.toString());
  }
}

function processPayment(sheet, row, sheetName, targetSpreadsheet, salesman, year, targetSheetName) {
  var jobNumber = sheet.getRange(row, 1).getValue(); // Job number in A
  var customerName = sheet.getRange(row, 2).getValue(); // Customer name in B
  Logger.log("Processing payment for Job Number: " + jobNumber + " on " + sheetName + ", Row: " + row);

  // Get K value from source sheet (column K, which is column 11) - this is the amount owed
  var sourceKValue = sheet.getRange(row, 11).getValue(); // Column K from source sheet
  sourceKValue = (typeof sourceKValue === "number" && !isNaN(sourceKValue)) ? sourceKValue : (typeof sourceKValue === "string" ? parseFloat(sourceKValue.replace(/[^0-9.-]+/g, "")) || 0 : 0);
  Logger.log("Source sheet K value (amount owed): " + sourceKValue);

  // Step 1: Update the corresponding target sheet (e.g., "2025 Brett")
  var targetSheet = targetSpreadsheet.getSheetByName(targetSheetName);
  if (!targetSheet) {
    Logger.log("Sheet '" + targetSheetName + "' not found in target spreadsheet");
    // Still record to Total Commissions even if target sheet not found
    try {
      recordCommissionPayment(salesman, jobNumber, customerName, sourceKValue, targetSpreadsheet, year);
    } catch (error) {
      Logger.log("Error recording commission payment: " + error.toString());
    }
    // Reset checkbox
    sheet.getRange(row, 12).setValue(false);
    return;
  }

  var lastRow = targetSheet.getLastRow();
  var jobNumbers = targetSheet.getRange("A1:A" + lastRow).getValues();

  var targetRow = -1;
  for (var i = 0; i < jobNumbers.length; i++) {
    if (jobNumbers[i][0] === jobNumber) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    Logger.log("Job number " + jobNumber + " not found in " + targetSheetName);
    // Still record to Total Commissions even if not found in target sheet
    try {
      recordCommissionPayment(salesman, jobNumber, customerName, sourceKValue, targetSpreadsheet, year);
    } catch (error) {
      Logger.log("Error recording commission payment: " + error.toString());
    }
    // Reset checkbox
    sheet.getRange(row, 12).setValue(false);
    return;
  }

  // Get Commission Data sheet from target spreadsheet
  var commissionDataSheet = targetSpreadsheet.getSheetByName("Commission Data");
  if (!commissionDataSheet) {
    Logger.log("Commission Data sheet not found in target spreadsheet");
    // Still record to Total Commissions even if Commission Data sheet not found
    try {
      recordCommissionPayment(salesman, jobNumber, customerName, sourceKValue, targetSpreadsheet, year);
    } catch (error) {
      Logger.log("Error recording commission payment: " + error.toString());
    }
    // Reset checkbox
    sheet.getRange(row, 12).setValue(false);
    return;
  }

  // Extract salesperson name from target sheet name (e.g., "2025 Brett" -> "Brett")
  var salesperson = salesman; // Already extracted in function parameters
  
  // Find the row in Commission Data for this job number and salesperson
  var dataLastRow = commissionDataSheet.getLastRow();
  var dataJobNumbers = commissionDataSheet.getRange("B2:B" + dataLastRow).getValues();
  var dataSalespeople = commissionDataSheet.getRange("C2:C" + dataLastRow).getValues();
  
  var dataRow = -1;
  for (var i = 0; i < dataJobNumbers.length; i++) {
    if (dataJobNumbers[i][0] === jobNumber && dataSalespeople[i][0] === salesperson) {
      dataRow = i + 2;
      break;
    }
  }

  var kValue = sourceKValue; // Default to source K value
  var jValue = 0; // Default J value
  var amountToRecord = sourceKValue; // Default to source K value for recording

  if (dataRow === -1) {
    Logger.log("Job " + jobNumber + " for " + salesperson + " not found in Commission Data - will still record to Total Commissions");
    // Continue processing to record to Total Commissions even if not in Commission Data
  } else {
    // Get J and K values from Commission Data
    jValue = commissionDataSheet.getRange(dataRow, 4).getValue(); // Column D (J paid)
    kValue = commissionDataSheet.getRange(dataRow, 5).getValue(); // Column E (K owed)

    Logger.log("Commission Data Row " + dataRow + ": J (paid): " + jValue + ", K (owed): " + kValue);

    jValue = (typeof jValue === "number" && !isNaN(jValue)) ? jValue : (typeof jValue === "string" ? parseFloat(jValue.replace(/[^0-9.-]+/g, "")) || 0 : 0);
    kValue = (typeof kValue === "number" && !isNaN(kValue)) ? kValue : (typeof kValue === "string" ? parseFloat(kValue.replace(/[^0-9.-]+/g, "")) || 0 : 0);
    
    // Use Commission Data K value if > 0, otherwise use sourceKValue (to avoid $0.00 entries)
    amountToRecord = kValue > 0 ? kValue : sourceKValue;

    // Update Commission Data: J = J + amountToRecord, K = 0
    commissionDataSheet.getRange(dataRow, 4).setValue(jValue + amountToRecord); // J paid (Column D)
    Logger.log("Updated J (paid) in Commission Data to: " + (jValue + amountToRecord));

    commissionDataSheet.getRange(dataRow, 5).setValue(0); // K owed (Column E)
    Logger.log("Set K (owed) in Commission Data to 0");
  }

  // Reset L checkbox in the source sheet after successful updates
  sheet.getRange(row, 12).setValue(false);
  Logger.log("Set L (checkbox) to false on " + sheetName + ", Row: " + row);

  // Step 2: Record payment in "Total Commissions" sheet using the determined amount
  // Only record if amount > 0 to avoid $0.00 entries
  if (amountToRecord > 0) {
    try {
      recordCommissionPayment(salesman, jobNumber, customerName, amountToRecord, targetSpreadsheet, year);
    } catch (error) {
      Logger.log("Error recording commission payment: " + error.toString());
    }
  } else {
    Logger.log("Skipping payment recording - amount is 0 or negative: " + amountToRecord);
  }

  // Step 3: Add note for James if Job ID < 1203 (only for 2025)
  if (salesman === "James" && year === "2025") {
    var sourceSheet = targetSpreadsheet.getSheetByName(year);
    if (sourceSheet) {
      var sourceLastRow = sourceSheet.getLastRow();
      var sourceJobNumbers = sourceSheet.getRange("B1:B" + sourceLastRow).getValues();
      var sourceJobIds = sourceSheet.getRange("A1:A" + sourceLastRow).getValues();

      var sourceRow = -1;
      for (var i = 0; i < sourceJobNumbers.length; i++) {
        if (sourceJobNumbers[i][0] === jobNumber) {
          sourceRow = i + 1;
          break;
        }
      }

      if (sourceRow !== -1) {
        var jobId = sourceJobIds[sourceRow - 1][0]; // Job ID from column A
        var jobIdNum = parseInt(jobId, 10); // Convert to number
        if (!isNaN(jobIdNum) && jobIdNum < 1203) {
          var noteCell = sheet.getRange(row, 13); // M (column 13) in "James" sheet
          noteCell.setValue("This job paid out at 4%");
          Logger.log("Added note 'This job paid out at 4%' to James sheet, Row: " + row + ", Job ID: " + jobId);
        }
      } else {
        Logger.log("Job number " + jobNumber + " not found in " + year + " sheet for Job ID check");
      }
    } else {
      Logger.log("Sheet '" + year + "' not found in target spreadsheet for Job ID check");
    }
  }

  // Step 4: Set T to FALSE in year sheet using job number matching
  var sourceSheet = targetSpreadsheet.getSheetByName(year);
  if (sourceSheet) {
    var sourceLastRow = sourceSheet.getLastRow();
    var sourceJobNumbers = sourceSheet.getRange("B1:B" + sourceLastRow).getValues();

    var sourceRow = -1;
    for (var i = 0; i < sourceJobNumbers.length; i++) {
      if (sourceJobNumbers[i][0] === jobNumber) {
        sourceRow = i + 1;
        break;
      }
    }

    if (sourceRow === -1) {
      Logger.log("Job number " + jobNumber + " not found in " + year + " sheet");
    } else {
      var tCell = sourceSheet.getRange(sourceRow, 20); // T column (column 20)
      tCell.setValue(false);
      Logger.log("Set T to FALSE on " + year + ", Row: " + sourceRow + " (Job Number: " + jobNumber + ")");
    }
  } else {
    Logger.log("Sheet '" + year + "' not found in target spreadsheet");
  }
}

function recordCommissionPayment(salesman, jobNumber, customerName, amountPaid, targetSpreadsheet, year) {
  // Total Commissions sheet is always in the active spreadsheet (Commission Sheet), not the target spreadsheet
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  
  // Extract just the salesman name (remove year if present)
  var salesmanName = String(salesman).replace(/\s+\d{4}$/, "").trim();
  
  // Determine which year's pay periods and Total Commissions sheet to use based on TODAY's date
  // This ensures payments made in 2026 go to 2026 pay periods, even if the commission sheet is "2025"
  var today = new Date();
  var currentYear = today.getFullYear().toString();
  var payPeriodYear = currentYear; // Use current year for pay period lookup
  
  // Try to use current year's Total Commissions sheet first
  var totalCommissionsSheetName = "Total Commissions " + payPeriodYear;
  var totalCommissionsSheet = spreadsheet.getSheetByName(totalCommissionsSheetName);
  
  // If current year's sheet doesn't exist, fall back to the year parameter (from sheet name)
  if (!totalCommissionsSheet && year) {
    totalCommissionsSheetName = "Total Commissions " + year;
    totalCommissionsSheet = spreadsheet.getSheetByName(totalCommissionsSheetName);
    if (totalCommissionsSheet) {
      payPeriodYear = year; // Use the sheet name year if that's what exists
      Logger.log("Current year sheet not found, using " + year + " sheet instead");
    }
  }
  
  if (!totalCommissionsSheet) {
    Logger.log("Sheet '" + totalCommissionsSheetName + "' not found in active spreadsheet (Commission Sheet).");
    return;
  }

  // Define pay periods and their date ranges for the pay period year (determined by current date)
  var payPeriods = [];
  if (payPeriodYear === "2025") {
    payPeriods = [
      { period: "Jan 6 & 13", start: new Date("2025-01-06"), end: new Date("2025-01-13") },
      { period: "Jan 20 & 27", start: new Date("2025-01-20"), end: new Date("2025-01-27") },
      { period: "Feb 3 & 10", start: new Date("2025-02-03"), end: new Date("2025-02-10") },
      { period: "Feb 17 & 24", start: new Date("2025-02-17"), end: new Date("2025-02-24") },
      { period: "Mar 3 & 10", start: new Date("2025-03-03"), end: new Date("2025-03-10") },
      { period: "Mar 17 & 24", start: new Date("2025-03-17"), end: new Date("2025-03-24") },
      { period: "Mar 31 & Apr 7", start: new Date("2025-03-31"), end: new Date("2025-04-07") },
      { period: "Apr 14 & 21", start: new Date("2025-04-14"), end: new Date("2025-04-21") },
      { period: "Apr 28 & May 5", start: new Date("2025-04-28"), end: new Date("2025-05-05") },
      { period: "May 12 & 19", start: new Date("2025-05-12"), end: new Date("2025-05-19") },
      { period: "May 26 & Jun 2", start: new Date("2025-05-26"), end: new Date("2025-06-02") },
      { period: "Jun 9 & 16", start: new Date("2025-06-09"), end: new Date("2025-06-16") },
      { period: "Jun 23 & 30", start: new Date("2025-06-23"), end: new Date("2025-06-30") },
      { period: "Jul 7 & 14", start: new Date("2025-07-07"), end: new Date("2025-07-14") },
      { period: "Jul 21 & 28", start: new Date("2025-07-21"), end: new Date("2025-07-28") },
      { period: "Aug 4 & 11", start: new Date("2025-08-04"), end: new Date("2025-08-11") },
      { period: "Aug 18 & 25", start: new Date("2025-08-18"), end: new Date("2025-08-25") },
      { period: "Sep 1 & 8", start: new Date("2025-09-01"), end: new Date("2025-09-08") },
      { period: "Sep 15 & 22", start: new Date("2025-09-15"), end: new Date("2025-09-22") },
      { period: "Sep 29 & Oct 6", start: new Date("2025-09-29"), end: new Date("2025-10-06") },
      { period: "Oct 13 & 20", start: new Date("2025-10-13"), end: new Date("2025-10-20") },
      { period: "Oct 27 & Nov 3", start: new Date("2025-10-27"), end: new Date("2025-11-03") },
      { period: "Nov 10 & 17", start: new Date("2025-11-10"), end: new Date("2025-11-17") },
      { period: "Nov 24 & Dec 1", start: new Date("2025-11-24"), end: new Date("2025-12-01") },
      { period: "Dec 8 & 15", start: new Date("2025-12-08"), end: new Date("2025-12-15") },
      { period: "Dec 22 & 29", start: new Date("2025-12-22"), end: new Date("2025-12-29") }
    ];
  } else if (payPeriodYear === "2026") {
    // 2026 pay periods adjusted by one day earlier
    payPeriods = [
      { period: "Jan 5 & 12", start: new Date("2026-01-05"), end: new Date("2026-01-12") },
      { period: "Jan 19 & 26", start: new Date("2026-01-19"), end: new Date("2026-01-26") },
      { period: "Feb 2 & 9", start: new Date("2026-02-02"), end: new Date("2026-02-09") },
      { period: "Feb 16 & 23", start: new Date("2026-02-16"), end: new Date("2026-02-23") },
      { period: "Mar 2 & 9", start: new Date("2026-03-02"), end: new Date("2026-03-09") },
      { period: "Mar 16 & 23", start: new Date("2026-03-16"), end: new Date("2026-03-23") },
      { period: "Mar 30 & Apr 6", start: new Date("2026-03-30"), end: new Date("2026-04-06") },
      { period: "Apr 13 & 20", start: new Date("2026-04-13"), end: new Date("2026-04-20") },
      { period: "Apr 27 & May 4", start: new Date("2026-04-27"), end: new Date("2026-05-04") },
      { period: "May 11 & 18", start: new Date("2026-05-11"), end: new Date("2026-05-18") },
      { period: "May 25 & Jun 1", start: new Date("2026-05-25"), end: new Date("2026-06-01") },
      { period: "Jun 8 & 15", start: new Date("2026-06-08"), end: new Date("2026-06-15") },
      { period: "Jun 22 & 29", start: new Date("2026-06-22"), end: new Date("2026-06-29") },
      { period: "Jul 6 & 13", start: new Date("2026-07-06"), end: new Date("2026-07-13") },
      { period: "Jul 20 & 27", start: new Date("2026-07-20"), end: new Date("2026-07-27") },
      { period: "Aug 3 & 10", start: new Date("2026-08-03"), end: new Date("2026-08-10") },
      { period: "Aug 17 & 24", start: new Date("2026-08-17"), end: new Date("2026-08-24") },
      { period: "Aug 31 & Sep 7", start: new Date("2026-08-31"), end: new Date("2026-09-07") },
      { period: "Sep 14 & 21", start: new Date("2026-09-14"), end: new Date("2026-09-21") },
      { period: "Sep 28 & Oct 5", start: new Date("2026-09-28"), end: new Date("2026-10-05") },
      { period: "Oct 12 & 19", start: new Date("2026-10-12"), end: new Date("2026-10-19") },
      { period: "Oct 26 & Nov 2", start: new Date("2026-10-26"), end: new Date("2026-11-02") },
      { period: "Nov 9 & 16", start: new Date("2026-11-09"), end: new Date("2026-11-16") },
      { period: "Nov 23 & 30", start: new Date("2026-11-23"), end: new Date("2026-11-30") },
      { period: "Dec 7 & 14", start: new Date("2026-12-07"), end: new Date("2026-12-14") },
      { period: "Dec 21 & 28", start: new Date("2026-12-21"), end: new Date("2026-12-28") }
    ];
  }

  // Find the current or next pay period (today was already set above)
  var currentPeriod = null;
  var periodRow = -1;
  for (var i = 0; i < payPeriods.length; i++) {
    if (today <= payPeriods[i].end) {
      currentPeriod = payPeriods[i].period;
      periodRow = i + 2; // Row 2 is "Jan 6 & 13" (header is row 1)
      break;
    }
  }

  // Fallback: Use the last period if no future period is found
  if (!currentPeriod && payPeriods.length > 0) {
    currentPeriod = payPeriods[payPeriods.length - 1].period;
    periodRow = payPeriods.length + 1;
    Logger.log("No current/future pay period found. Using last period: " + currentPeriod);
  }

  if (!currentPeriod) {
    Logger.log("No pay periods defined.");
    return;
  }

  Logger.log("Current pay period: " + currentPeriod + " (Row: " + periodRow + ") for year " + payPeriodYear);

  // Map salesman to column (year-specific mapping based on pay period year)
  var salesmanColumn;
  if (payPeriodYear === "2025") {
    var columnMap2025 = {
      "Brett": 2,
      "Drew": 3,
      "James": 4,
      "Geoff": 5,
      "Adam": 6
    };
    salesmanColumn = columnMap2025[salesmanName];
  } else if (payPeriodYear === "2026") {
    var columnMap2026 = {
      "Brett": 2,
      "Drew": 3,
      "James": 4,
      "Mike": 5
    };
    salesmanColumn = columnMap2026[salesmanName];
  }

  if (!salesmanColumn) {
    Logger.log("Salesman '" + salesmanName + "' not found in column mapping for year " + payPeriodYear + ".");
    return;
  }

  // Format the payment entry
  var paymentEntry = jobNumber + " - " + customerName + " - $" + amountPaid.toFixed(2);

  // Update the cell (check for duplicates first)
  var currentCell = totalCommissionsSheet.getRange(periodRow, salesmanColumn);
  var currentContent = currentCell.getValue();
  
  // Check if this job number already exists in the cell (to prevent duplicates even with different amounts)
  if (currentContent && String(currentContent).indexOf(jobNumber) !== -1) {
    Logger.log("Job number " + jobNumber + " already exists in pay period, skipping duplicate: " + paymentEntry);
    return; // Don't add duplicate entry
  }
  
  var updatedContent = currentContent ? currentContent + "\n" + paymentEntry : paymentEntry;
  currentCell.setValue(updatedContent);

  // Ensure changes are committed
  SpreadsheetApp.flush();

  Logger.log("Recorded payment for " + salesmanName + " in row " + periodRow + ", column " + salesmanColumn + ": " + paymentEntry);
}

function highlightRows() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  // Support both "Salesman" and "Salesman Year" formats for backward compatibility
  var validSheets2025 = ["Adam 2025", "Brett 2025", "Drew 2025", "James 2025", "Geoff 2025", "Adam", "Brett", "Drew", "James", "Geoff"];
  var validSheets2026 = ["Brett 2026", "Drew 2026", "James 2026", "Mike 2026"];
  var validSheets = validSheets2025.concat(validSheets2026);

  validSheets.forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      // Don't log error for sheets that might not exist yet
      return;
    }

    var activeRange = sheet.getDataRange();
    var activeValues = activeRange.getValues();

    for (var i = 1; i < activeValues.length; i++) {
      var colC = activeValues[i][2];  // Column C
      var colD = activeValues[i][3];  // Column D
      var colK = activeValues[i][10]; // Column K

      var rowRange = sheet.getRange(i + 1, 1, 1, 12); 

      // Reset colors
      rowRange.setBackground(null);

      var dStr = String(colD);
      var dValue = (dStr.indexOf("%") !== -1)
        ? parseFloat(dStr.replace("%", "")) / 100 
        : parseFloat(dStr.replace(/[^0-9.-]+/g, "")) || 0;
      var kValue = parseFloat(String(colK).replace(/[^0-9.-]+/g, "")) || 0;

      // Apply row-level colors
      if (kValue > 0) {
        rowRange.setBackground("yellow"); 
      } else if (colC === true) {
        rowRange.setBackground("green"); 
      }

      // Then independently apply red to just D if GP% fails
      if (colD !== "" && dValue !== 0 && dValue < 0.32) {
        var dCell = sheet.getRange(i + 1, 4); // column D
        dCell.setBackground("red");
      }
    }
    Logger.log("Highlighting applied to " + sheetName);
  });
}


function createTimeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "highlightRows") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("highlightRows")
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log("Time-driven trigger created for highlightRows (every 10 minutes).");
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Commission Tools')
    .addItem('Install Checkbox Trigger', 'installOnEditTrigger')
    .addItem('List All Triggers', 'listAllTriggers')
    .addItem('Remove All Triggers', 'removeAllTriggers')
    .addSeparator()
    .addItem('Process Checked Boxes for Brett', 'processCheckedBoxesForBrett')
    .addSeparator()
    .addItem('Highlight Rows', 'highlightRows')
    .addToUi();
}

function installOnEditTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var deletedCount = 0;
  
  // Remove ALL existing triggers for both old and new function names
  for (var i = 0; i < triggers.length; i++) {
    var funcName = triggers[i].getHandlerFunction();
    if (funcName === "onEdit" || funcName === "onEditTrigger") {
      ScriptApp.deleteTrigger(triggers[i]);
      deletedCount++;
    }
  }
  
  // Create new trigger for onEditTrigger function
  ScriptApp.newTrigger("onEditTrigger")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  // Create/refresh time-driven trigger for highlightRows
  createTimeTrigger();
  
  SpreadsheetApp.getUi().alert('Checkbox trigger installed successfully!\nRemoved ' + deletedCount + ' old trigger(s), installed 1 new trigger.\nHighlighting trigger set to run every 10 minutes.');
  Logger.log("Removed " + deletedCount + " old trigger(s) and created 1 new onEditTrigger trigger plus highlightRows time trigger.");
}

function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
    count++;
  }
  
  SpreadsheetApp.getUi().alert('Removed ' + count + ' trigger(s).');
  Logger.log("Removed " + count + " trigger(s).");
}

function listAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var message = "Total triggers: " + triggers.length + "\n\n";
  
  for (var i = 0; i < triggers.length; i++) {
    message += (i + 1) + ". Function: " + triggers[i].getHandlerFunction() + "\n";
    message += "   Type: " + triggers[i].getEventType() + "\n\n";
  }
  
  SpreadsheetApp.getUi().alert(message);
  Logger.log(message);
}

// Manually process any checked boxes in column L for Brett's sheet
function processCheckedBoxesForBrett() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  // Try "Brett 2025" first, then "Brett" for backward compatibility
  var sheet = spreadsheet.getSheetByName("Brett 2025") || spreadsheet.getSheetByName("Brett");
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Brett sheet not found.");
    Logger.log("Brett sheet not found.");
    return;
  }
  
  var sheetName = sheet.getName();
  var year = sheetName.match(/\s+(\d{4})$/);
  year = year ? year[1] : "2025"; // Default to 2025
  var salesman = "Brett";
  var targetSheetName = year + " " + salesman;
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No data found in Brett sheet.");
    Logger.log("No data found in Brett sheet.");
    return;
  }
  
  // Get all values in column L
  var lColumnValues = sheet.getRange(2, 12, lastRow - 1, 1).getValues();
  var checkedRows = [];
  
  // Find all checked boxes (TRUE values)
  for (var i = 0; i < lColumnValues.length; i++) {
    if (lColumnValues[i][0] === true) {
      checkedRows.push(i + 2); // +2 because we started at row 2 and arrays are 0-indexed
    }
  }
  
  if (checkedRows.length === 0) {
    SpreadsheetApp.getUi().alert("No checked boxes found in column L for Brett sheet.");
    Logger.log("No checked boxes found in column L for Brett sheet.");
    return;
  }
  
  Logger.log("Found " + checkedRows.length + " checked box(es) in Brett sheet: rows " + checkedRows.join(", "));
  
  // Process each checked row
  var targetSpreadsheetId = "1eO365hmI2Nm9_YssKGka92teOkoRD0uzSnM0r31D7ek";
  var targetSpreadsheet;
  try {
    targetSpreadsheet = SpreadsheetApp.openById(targetSpreadsheetId);
    Logger.log("Successfully opened target spreadsheet: " + targetSpreadsheetId);
  } catch (error) {
    SpreadsheetApp.getUi().alert("Error opening target spreadsheet: " + error.toString());
    Logger.log("Error opening target spreadsheet: " + error.toString());
    return;
  }
  
  var processedCount = 0;
  var errorCount = 0;
  
  for (var j = 0; j < checkedRows.length; j++) {
    var row = checkedRows[j];
    try {
      processPayment(sheet, row, sheetName, targetSpreadsheet, salesman, year, targetSheetName);
      processedCount++;
      Logger.log("Successfully processed row " + row);
    } catch (error) {
      errorCount++;
      Logger.log("Error processing row " + row + ": " + error.toString());
    }
  }
  
  var message = "Processed " + processedCount + " checked box(es) successfully.";
  if (errorCount > 0) {
    message += "\n" + errorCount + " error(s) occurred. Check logs for details.";
  }
  
  SpreadsheetApp.getUi().alert(message);
  Logger.log(message);
}
