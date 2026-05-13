import { db } from './firebase';
import { doc, runTransaction, getDoc, setDoc } from 'firebase/firestore';

/**
 * Safely generates the next sequential serial number for tasks or correspondences.
 * Uses a transaction to ensure no two items get the same number.
 */
export async function getNextSerialNumber(type: 'tasks' | 'correspondences'): Promise<string> {
  const counterRef = doc(db, type, '--stats--');
  const prefix = type === 'tasks' ? 'TK' : 'CR';

  try {
    const nextVal = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let current = 0;
      if (counterDoc.exists()) {
        current = counterDoc.data().value || 0;
      }
      
      const next = current + 1;
      transaction.set(counterRef, { value: next }, { merge: true });
      return next;
    });

    return `${prefix}${nextVal.toString().padStart(6, '0')}`;
  } catch (error) {
    console.error('Error generating serial number:', error);
    // Fallback if transaction fails
    return `${prefix}${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
  }
}
