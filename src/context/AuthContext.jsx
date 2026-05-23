import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  updateProfile,
  deleteUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  deleteDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        
        // Fetch user profile from Firestore
        const userDocRef = doc(db, 'users', user.uid);
        try {
          const docSnap = await getDoc(userDocRef);
          
          if (docSnap.exists()) {
            setUserProfile(docSnap.data());
          } else {
            // New user, automatically assign 'student' role
            const profileData = {
              uid: user.uid,
              name: user.displayName || 'Anonymous User',
              email: user.email,
              role: 'student',
              photoURL: user.photoURL || '',
              createdAt: serverTimestamp()
            };
            await setDoc(userDocRef, profileData);
            setUserProfile(profileData);
          }
        } catch (error) {
          console.error("Error fetching or creating user profile:", error);
          setAuthError(`Failed to load profile: ${error.message}`);
        }
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Google authentication failed:", error);
      // Surface a user-friendly message based on the error code
      if (error.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed. Please try again.');
      } else if (error.code === 'auth/popup-blocked') {
        setAuthError('Popup was blocked by the browser. Please allow popups for this site.');
      } else if (error.code === 'auth/operation-not-allowed') {
        setAuthError('Google sign-in is not enabled. Please contact the administrator.');
      } else if (error.code === 'auth/unauthorized-domain') {
        setAuthError('This domain is not authorized for sign-in. Please contact the administrator.');
      } else {
        setAuthError(error.message || 'Authentication failed. Please try again.');
      }
      setLoading(false);
    }
  };


  const logout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      // Trigger full page reload to clear memory state and cache
      window.location.reload();
    } catch (error) {
      console.error("Sign out failed:", error);
      setLoading(false);
    }
  };

  const updateUserProfile = async (name, photoURL) => {
    if (!currentUser) return;
    setLoading(true);
    try {
      await updateProfile(auth.currentUser, { displayName: name, photoURL });
      
      const userDocRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userDocRef, { name, photoURL });
      
      setUserProfile(prev => ({ ...prev, name, photoURL }));
      setAuthError(null);
    } catch (error) {
      console.error("Profile update failed:", error);
      setAuthError(`Update failed: ${error.message}`);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // Delete Firestore document first
      await deleteDoc(doc(db, 'users', currentUser.uid));
      // Delete Auth user
      await deleteUser(auth.currentUser);
      
      setCurrentUser(null);
      setUserProfile(null);
      // The auth state observer will catch the delete, but we reload to be completely safe
      window.location.reload();
    } catch (error) {
      console.error("Account deletion failed:", error);
      if (error.code === 'auth/requires-recent-login') {
        setAuthError('Security verification required. Please sign out and sign in again before deleting your account.');
      } else {
        setAuthError(`Deletion failed: ${error.message}`);
      }
      setLoading(false);
      throw error;
    }
  };

  const clearError = () => setAuthError(null);

  const value = {
    currentUser,
    userProfile,
    loading,
    authError,
    loginWithGoogle,
    updateUserProfile,
    deleteAccount,
    logout,
    clearError
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
