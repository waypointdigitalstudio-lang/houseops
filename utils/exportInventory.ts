// utils/exportInventory.ts
import { collection, getDocs, query, where } from 'firebase/firestore';
import Share from 'react-native-share';

import { db } from '../firebaseConfig';

type Item = {
  id: string;
  name: string;
  currentQuantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
  siteId?: string;
};

export async function exportInventoryToCSV(siteId: string): Promise<void> {
  try {
    // Fetch all items for this site
    const q = query(collection(db, 'items'), where('siteId', '==', siteId));
    const snap = await getDocs(q);

    const items: Item[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || '',
        currentQuantity: data.currentQuantity ?? 0,
        minQuantity: data.minQuantity ?? 0,
        location: data.location || '',
        barcode: data.barcode || '',
        notes: data.notes || '',
        siteId: data.siteId || '',
      };
    });

    if (items.length === 0) {
      throw new Error('No inventory items found for this site');
    }

    // Sort by name
    items.sort((a, b) => a.name.localeCompare(b.name));

    // Create CSV content
    const headers = ['Name', 'Current Qty', 'Min Qty', 'Location', 'Barcode', 'Notes', 'Status'];
    const rows = items.map((item) => {
      const status = item.currentQuantity <= item.minQuantity ? 'Low Stock' : 'OK';
      return [
        escapeCSV(item.name),
        item.currentQuantity,
        item.minQuantity,
        escapeCSV(item.location || ''),
        escapeCSV(item.barcode || ''),
        escapeCSV(item.notes || ''),
        status,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const siteName = siteId.replace('ballys_', '');
    const filename = `inventory_${siteName}_${date}.csv`;

    // Convert to base64
    const base64 = Buffer.from(csv, 'utf8').toString('base64');

    // Share using base64 data URI
    await Share.open({
      title: 'Export Inventory',
      message: `Inventory export from Control Deck - ${siteName}`,
      url: `data:text/csv;base64,${base64}`,
      filename: filename,
      subject: `Inventory Export - ${siteName} - ${date}`,
    });

  } catch (error: any) {
    if (error.message === 'User did not share') {
      return;
    }
    console.error('Export failed:', error);
    throw error;
  }
}

// Helper to escape CSV values
function escapeCSV(value: string): string {
  if (!value) return '';
  
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  
  return value;
}