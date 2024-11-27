import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { AuthLog } from '../types/Authlogs';

function validateAuthLog(data: any): { isValid: boolean; error?: string } {
  // Check required fields
  if (!data.userId || typeof data.userId !== 'string') {
    return { isValid: false, error: 'Invalid or missing userId' };
  }
  
  if (!data.userName || typeof data.userName !== 'string') {
    return { isValid: false, error: 'Invalid or missing userName' };
  }

  // Validate action is one of the allowed values
  if (!data.action || !['login', 'logout'].includes(data.action)) {
    return { isValid: false, error: 'Action must be either "login" or "logout"' };
  }

  // Validate success is boolean
  if (typeof data.success !== 'boolean') {
    return { isValid: false, error: 'Success must be a boolean value' };
  }

  // Optional field validations
  if (data.leagueId && typeof data.leagueId !== 'string') {
    return { isValid: false, error: 'LeagueId must be a string' };
  }

  if (data.error && typeof data.error !== 'string') {
    return { isValid: false, error: 'Error must be a string' };
  }

  return { isValid: true };
}

export const logAuth = async (data: AuthLog) => {
  try {
    // Validate the input data
    const validation = validateAuthLog(data);
    if (!validation.isValid) {
      console.error('Validation error:', validation.error);
      return { success: false, error: validation.error };
    }

    const authLogsRef = collection(db, 'authLogs');
    await addDoc(authLogsRef, {
      ...data,
      timestamp: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error('Error logging auth:', error);
    return { success: false, error: 'Failed to log authentication' };
  }
};

export async function getAuthLogs(): Promise<AuthLog[]> {
  const q = query(
    collection(db, 'authLogs'),
    orderBy('timestamp', 'desc'),
    limit(50)
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({
    ...doc.data(),
    timestamp: doc.data().timestamp?.toDate()
  })) as AuthLog[];
} 