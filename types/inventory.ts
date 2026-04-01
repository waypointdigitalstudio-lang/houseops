export type Item = {
  id: string;
  name: string;
  currentQuantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
};

export type Toner = {
  id: string;
  model: string;
  color: string;
  quantity: number;
  minQuantity: number;
  printer?: string;
  notes?: string;
  barcode?: string;
  partNumber?: string;
  siteId: string;
};

export type Printer = {
  id: string;
  name: string;
  location?: string;
  ipAddress?: string;
  assetNumber?: string;
  serial?: string;
  tonerSeries?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
  tonerId?: string;
  importedAt?: string;
};

export type DataCardPrinter = {
  id: string;
  name: string;
  location?: string;
  ipAddress?: string;
  assetNumber?: string;
  serial?: string;
  ribbonType?: string;
  notes?: string;
  siteId: string;
};

export type Radio = {
  id: string;
  model: string;
  serialNumber?: string;
  channel?: string;
  assignedTo?: string;
  location?: string;
  condition?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
};

export type RadioPart = {
  id: string;
  name: string;
  compatibleModel?: string;
  quantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
};

export type TonerLink = {
  id: string;
  name: string;
  stock: number;
};

export type SortMode = "name" | "stock";
export type TabMode = "inventory" | "toners" | "radios";
export type TonerSubTab = "toners" | "printers" | "datacard";
export type RadioSubTab = "radios" | "parts";
export type StockStatus = "OK" | "LOW" | "OUT";

export const TONER_COLORS = ["Black", "Cyan", "Magenta", "Yellow", "Other"];
export const UNDO_TIMEOUT_MS = 5000;
export const UNDO_ANIMATION_MS = 180;
