/** Personal commission workbook: Drew */
function onEdit(e) {
  if (!e) {
    Logger.log("Script was run manually, exiting.");
    return;
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var sheetName = sheet.getName();
  
  if (sheetName === "2025" || sheetName === "2026") {
    highlightRows(sheetName);
  } else if (sheetName === "2025 Pay" || sheetName === "2026 Pay") {
    sumDollarAmountsPerCellForSheet(sheetName);
  }
}

function highlightRows(specificSheetName) {
  try {
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // If a specific sheet name is provided (and it's actually a string), only process that sheet
    // Otherwise, process both 2025 and 2026 sheets (for time-based triggers)
    // Time-based triggers pass an event object, so we need to check if it's actually a string
    var isValidSheetName = typeof specificSheetName === 'string' && (specificSheetName === "2025" || specificSheetName === "2026");
    var sheetsToProcess = [];
    
    if (isValidSheetName) {
      sheetsToProcess = [specificSheetName];
    } else {
      // If called from time-based trigger (passed event object), always process both sheets
      // Time-based triggers should process both regardless of active sheet
      var isEventObject = specificSheetName && typeof specificSheetName === 'object' && !Array.isArray(specificSheetName);
      if (isEventObject) {
        sheetsToProcess = ["2025", "2026"];
      } else {
        // Called manually or from onEdit - check active sheet
        try {
          var activeSheet = activeSpreadsheet.getActiveSheet();
          var activeSheetName = activeSheet ? activeSheet.getName() : null;
          if (activeSheetName === "2025" || activeSheetName === "2026") {
            sheetsToProcess = [activeSheetName];
          } else {
            sheetsToProcess = ["2025", "2026"];
          }
        } catch (e) {
          // No active sheet, process both
          sheetsToProcess = ["2025", "2026"];
        }
      }
    }
    
    // Process each sheet
    for (var s = 0; s < sheetsToProcess.length; s++) {
      var sheetName = sheetsToProcess[s];
      var sheet = activeSpreadsheet.getSheetByName(sheetName);
      
      if (!sheet) {
        Logger.log("Sheet '" + sheetName + "' not found, skipping.");
        continue;
      }
      
      highlightRowsForSheet(sheet, sheetName);
    }
  } catch (error) {
    Logger.log("Error in highlightRows: " + error.toString());
    Logger.log("Stack: " + error.stack);
  }
}

function highlightRowsForSheet(sheet, sheetName) {
  Logger.log("Running highlightRows on sheet: " + sheetName);
  
  var range = sheet.getDataRange();
  var values = range.getValues();

  var targetSpreadsheetId = "1eO365hmI2Nm9_YssKGka92teOkoRD0uzSnM0r31D7ek";
  var targetSpreadsheet;
  try {
    targetSpreadsheet = SpreadsheetApp.openById(targetSpreadsheetId);
  } catch (error) {
    Logger.log("Error opening target spreadsheet: " + error.toString());
    return;
  }

  var targetSheet = targetSpreadsheet.getSheetByName(sheetName);
  if (!targetSheet) {
    Logger.log("Sheet '" + sheetName + "' not found in target spreadsheet.");
    return;
  }

  var targetRange = targetSheet.getDataRange();
  var targetValues = targetRange.getValues();

  var jobNumberMap = {};
  for (var j = 1; j < targetValues.length; j++) {
    var jobNumber = targetValues[j][1];
    var oValue = targetValues[j][14];
    if (jobNumber) {
      jobNumberMap[jobNumber] = (typeof oValue === "string" && oValue.indexOf("%") !== -1)
        ? parseFloat(oValue.replace("%", "").replace("GP %", "").trim()) / 100
        : parseFloat(String(oValue)) || 0;
    }
  }

  for (var i = 1; i < values.length; i++) {
    var colA = values[i][0];
    
    // Skip blank rows - check if column A is empty or blank
    if (!colA || String(colA).trim() === "") {
      continue; // Skip this row entirely
    }
    
    var colC = values[i][2];
    var colG = values[i][6];
    var colH = values[i][7];
    var colI = values[i][8];
    var colJ = values[i][9];

    var rowRange = sheet.getRange(i + 1, 1, 1, 10);

    Logger.log("Row " + (i + 1) + " before highlight - A: " + colA + ", C: " + colC + ", G: " + colG + ", H: " + colH + ", I: " + colI + ", J: " + colJ);

    rowRange.setBackground(null);

    var gValue = parseFloat(String(colG).replace(/[^0-9.-]+/g, "")) || 0;
    var hValue = Math.round((parseFloat(String(colH).replace(/[^0-9.-]+/g, "")) || 0) * 100) / 100;
    var iValue = Math.round((parseFloat(String(colI).replace(/[^0-9.-]+/g, "")) || 0) * 100) / 100;
    // Parse jValue and round to 2 decimal places to avoid floating point issues
    var jValue = Math.round((parseFloat(String(colJ).replace(/[^0-9.-]+/g, "")) || 0) * 100) / 100;

    var oValue = jobNumberMap[colA] || 0;

    // Additional check: only process if column A has a valid numeric value
    if (parseFloat(String(colA)) > 0) {
      // Green if: Commission Paid >= Expected Commission, OR (checkbox is checked AND Commission Owed = 0)
      // Checkbox is boolean, so check directly: colC === true
      var checkboxCondition = colC === true;
      var zeroOwedCondition = Math.abs(jValue) < 0.01; // Use tolerance for floating point
      var paidCondition = iValue >= hValue;
      // Green only if fully paid OR (checkbox checked AND nothing owed)
      var isGreen = paidCondition || (checkboxCondition && zeroOwedCondition);
      var isRed = oValue > 0 && oValue < 0.32;
      var isYellow = jValue > 0.01; // Use tolerance instead of exact 0
      
      if (isYellow && isGreen) {
        rowRange.setBackground("yellow");
        Logger.log("Row " + (i + 1) + " set to yellow (Yellow overrides Green: J: " + jValue + ")");
      } else if (isGreen && isRed) {
        rowRange.setBackground("green");
        Logger.log("Row " + (i + 1) + " set to green (Green overrides Red: I: " + iValue + ", H: " + hValue + ", C: " + colC + ")");
      } else if (isRed && isYellow) {
        rowRange.setBackground("red");
        Logger.log("Row " + (i + 1) + " set to red (Red overrides Yellow: O: " + oValue + ")");
      } else if (isYellow) {
        rowRange.setBackground("yellow");
        Logger.log("Row " + (i + 1) + " set to yellow (J: " + jValue + ")");
      } else if (isGreen) {
        rowRange.setBackground("green");
        Logger.log("Row " + (i + 1) + " set to green (I: " + iValue + ", H: " + hValue + ", C: " + colC + ")");
      } else if (isRed) {
        rowRange.setBackground("red");
        Logger.log("Row " + (i + 1) + " set to red (O: " + oValue + ")");
      }
    }
  }
}

function sumDollarAmountsPerCell(specificSheetName) {
  try {
    var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // If a specific sheet name is provided (and it's actually a string), only process that sheet
    // Otherwise, process both 2025 Pay and 2026 Pay sheets (for time-based triggers)
    // Time-based triggers pass an event object, so we need to check if it's actually a string
    var isValidSheetName = typeof specificSheetName === 'string' && specificSheetName.trim().length > 0;
    var paySheets = isValidSheetName ? [specificSheetName] : ["2025 Pay", "2026 Pay"];
    
    Logger.log("sumDollarAmountsPerCell started - processing sheets: " + paySheets.join(", "));
    
    for (var s = 0; s < paySheets.length; s++) {
      try {
        var sheetName = paySheets[s];
        var sheet = activeSpreadsheet.getSheetByName(sheetName);
        
        if (!sheet) {
          Logger.log("Sheet '" + sheetName + "' not found, skipping.");
          continue;
        }

        Logger.log("Processing sumDollarAmountsPerCell for sheet: " + sheetName);
        
        var range = sheet.getRange("B2:B27");
        var values = range.getValues();
        var output = [];

        for (var i = 0; i < values.length; i++) {
          var cellValue = values[i][0];
          var total = 0;

          if (cellValue) {
            var lines = String(cellValue).split("\n");
            for (var j = 0; j < lines.length; j++) {
              var line = lines[j].trim();
              if (!line) continue;
              var match = line.match(/\$([\d.]+)/);
              if (match && match[1]) {
                var dollarAmount = parseFloat(match[1]);
                if (!isNaN(dollarAmount)) {
                  total += dollarAmount;
                }
              }
            }
          }
          output.push([total]);
        }

        sheet.getRange("C2:C27").setValues(output);
        Logger.log("Completed sumDollarAmountsPerCell for sheet: " + sheetName + " - updated " + output.length + " rows");
      } catch (sheetError) {
        Logger.log("Error processing sheet " + paySheets[s] + ": " + sheetError.toString());
        // Continue with next sheet
      }
    }
    Logger.log("sumDollarAmountsPerCell completed successfully");
  } catch (error) {
    Logger.log("Error in sumDollarAmountsPerCell: " + error.toString());
    Logger.log("Stack trace: " + error.stack);
  }
}

// Helper function for onEdit to process a specific sheet
function sumDollarAmountsPerCellForSheet(sheetName) {
  sumDollarAmountsPerCell(sheetName);
}

function createTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var deletedCount = 0;
  
  for (var i = 0; i < triggers.length; i++) {
    var funcName = triggers[i].getHandlerFunction();
    if (funcName === "highlightRows" || funcName === "onEdit" || funcName === "sumDollarAmountsPerCell") {
      ScriptApp.deleteTrigger(triggers[i]);
      deletedCount++;
    }
  }

  // Create triggers
  var highlightTrigger = ScriptApp.newTrigger("highlightRows").timeBased().everyMinutes(1).create();
  var sumTrigger = ScriptApp.newTrigger("sumDollarAmountsPerCell").timeBased().everyMinutes(1).create();
  var onEditTrigger = ScriptApp.newTrigger("onEdit").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  
  Logger.log("Deleted " + deletedCount + " trigger(s). Created 3 new triggers.");
  Logger.log("Highlight trigger ID: " + highlightTrigger.getUniqueId());
  Logger.log("Sum trigger ID: " + sumTrigger.getUniqueId());
  Logger.log("onEdit trigger ID: " + onEditTrigger.getUniqueId());
  
  // Show message if in UI context
  try {
    SpreadsheetApp.getUi().alert('Triggers installed successfully!\nDeleted ' + deletedCount + ' old trigger(s).\nCreated 3 new triggers.');
  } catch (e) {
    // Not in UI context, that's fine
  }
}

// Check existing triggers
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var message = "Total triggers: " + triggers.length + "\n\n";
  
  for (var i = 0; i < triggers.length; i++) {
    message += (i + 1) + ". Function: " + triggers[i].getHandlerFunction() + "\n";
    message += "   Type: " + triggers[i].getEventType() + "\n";
    message += "   ID: " + triggers[i].getUniqueId() + "\n\n";
  }
  
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log("Cannot show UI alert");
  }
}
