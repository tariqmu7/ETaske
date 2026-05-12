import { db } from './firebase';
import { doc, runTransaction, getDoc, setDoc } from 'firebase/firestore';

/**
 * Safely generates the next sequential serial number for tasks or correspondences.
 * Uses a transaction to ensure no two items get the same number.
 */
export async function getNextSerialNumber(type: 'tasks' | 'correspondences'): Promise<string> {
  const counterRef = doc(db, 'metadata', 'counters');
  const prefix = type === 'tasks' ? 'T' : 'C';

  try {
    const nextVal = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let current = 0;
      if (counterDoc.exists()) {
        current = counterDoc.data()[type] || 0;
      }
      
      const next = current + 1;
      
      if (!counterDoc.exists()) {
        transaction.set(counterRef, { [type]: next });
      } else {
        transaction.update(counterRef, { [type]: next });
      }
      
      return next;
    });

    return `${prefix}-${nextVal.toString().padStart(4, '0')}`;
  } catch (error) {
    console.error('Error generating serial number:', error);
    // Fallback if transaction fails (should be rare)
    return `${prefix}-${Date.now().toString().slice(-6)}`;
  }
}
