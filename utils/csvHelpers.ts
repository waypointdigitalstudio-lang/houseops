import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export const normalizeCell = (val: string): string => {
  if (!val) return "";
  const trimmed = val.trim();
  if (["nan", "none", "null", "-", "n/a"].includes(trimmed.toLowerCase())) return "";
  return trimmed;
};

export const parseCSV = (content: string): string[][] => {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const firstLine = lines[0];
  const delimiter = firstLine.includes("|") ? "|" : firstLine.includes(";") ? ";" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
};

export const downloadInventoryTemplate = async () => {
  try {
    const content = [
      "Name,Current Quantity,Min Quantity,Location,Barcode,Notes",
      '"AA Batteries",24,10,"Storage Room A, Shelf 3","012345678901","Check expiry dates"',
      '"Copy Paper (Ream)",15,5,"Supply Closet","","Letter size 8.5x11"',
    ].join("\n");
    const uri = FileSystem.cacheDirectory + "inventory_template.csv";
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Inventory CSV Template" });
  } catch (err: any) {
    throw err;
  }
};

export const downloadTonerTemplate = async () => {
  try {
    const content = [
      "Model,Color,Quantity,Min Qty,Printer",
      '"CF217A",Black,3,1,"HP LaserJet Pro M102"',
      '"202X",Cyan,2,1,"HP Color LaserJet M479"',
    ].join("\n");
    const uri = FileSystem.cacheDirectory + "toner_template.csv";
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Toner CSV Template" });
  } catch (err: any) {
    throw err;
  }
};

export const downloadPrinterTemplate = async () => {
  try {
    const content = [
      "Name,Location,IP Address,Asset Number,Serial,Toner Series,Barcode,Notes",
      '"HP LaserJet Pro M404","Front Office","192.168.1.50","AST-001","VNC3W12345","CF217A-series","","Main office printer"',
      '"Canon PIXMA G3260","Break Room","192.168.1.51","AST-002","","","","Color printer"',
    ].join("\n");
    const uri = FileSystem.cacheDirectory + "printer_template.csv";
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Printer CSV Template" });
  } catch (err: any) {
    throw err;
  }
};

export const downloadRadioTemplate = async () => {
  try {
    const content = [
      "Model,Serial Number,Channel,Assigned To,Location,Condition,Notes",
      '"Motorola RDU2020","ABC123","Ch 3","John Smith","Security Desk","Good",""',
      '"Kenwood TK-2400","XYZ456","Ch 1","Jane Doe","Front Desk","Good",""',
    ].join("\n");
    const uri = FileSystem.cacheDirectory + "radio_template.csv";
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Radio CSV Template" });
  } catch (err: any) {
    throw err;
  }
};

export const downloadRadioPartTemplate = async () => {
  try {
    const content = [
      "Name,Compatible Model,Quantity,Min Quantity,Location,Barcode,Notes",
      '"Belt Clip","Motorola RDU2020",5,2,"Storage Room B","","Standard clip"',
      '"Battery Pack","Kenwood TK-2400",3,1,"Storage Room B","012345678902",""',
    ].join("\n");
    const uri = FileSystem.cacheDirectory + "radio_parts_template.csv";
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Radio Parts CSV Template" });
  } catch (err: any) {
    throw err;
  }
};

export const downloadDisposalTemplate = async () => {
  try {
    const content = [
      "Item Name,Model,Quantity,Unit Value ($),Vendor,Total Value ($),Approx Age,Description,Disposed By",
      '"HP LaserJet Pro","M404",1,150.00,"HP Direct",150.00,"4 years","End of life - replaced with newer model","John Smith"',
      '"Office Chair","",3,25.00,"",75.00,"6 years","Broken - unrepairable","Jane Doe"',
    ].join("\n");
    const uri = FileSystem.cacheDirectory + "disposal_template.csv";
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Asset Disposal CSV Template" });
  } catch (err: any) {
    throw err;
  }
};
