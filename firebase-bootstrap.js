(async () => {
  try {
    const [appMod, firestoreMod, authMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js'),
    ]);

    window.firebase = {
      initializeApp: appMod.initializeApp,
      getFirestore: firestoreMod.getFirestore,
      collection: firestoreMod.collection,
      doc: firestoreMod.doc,
      addDoc: firestoreMod.addDoc,
      updateDoc: firestoreMod.updateDoc,
      deleteDoc: firestoreMod.deleteDoc,
      setDoc: firestoreMod.setDoc,
      writeBatch: firestoreMod.writeBatch,
      getDoc: firestoreMod.getDoc,
      getDocs: firestoreMod.getDocs,
      onSnapshot: firestoreMod.onSnapshot,
      query: firestoreMod.query,
      where: firestoreMod.where,
      getAuth: authMod.getAuth,
      signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
      signOut: authMod.signOut,
      onAuthStateChanged: authMod.onAuthStateChanged,
    };
    window.dispatchEvent(new Event('firebase-ready'));
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('Firebase SDK load failed:', err);
  }
})();
