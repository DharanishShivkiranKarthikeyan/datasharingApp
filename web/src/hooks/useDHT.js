import { useState, useCallback } from 'react';
import { useAuth } from './useAuth.js';
import { doc, getDocs, setDoc, updateDoc, increment, query, where, onSnapshot } from 'firebase/firestore';

export const useDHT = () => {
  const { user, isAuthenticated } = useAuth();
  const [dht, setDht] = useState(window.dht);

  const updateBalanceDisplay = useCallback(async () => {
    const userBalanceElement = document.getElementById('userBalance');
    if (!userBalanceElement) return;

    if (!dht) {
      userBalanceElement.textContent = 'Balance: 0 DCT';
      return;
    }

    try {
      const userBalance = (await dht.getBalance(dht.keypair)) || 0;
      userBalanceElement.textContent = `Balance: ${userBalance} DCT`;
    } catch (error) {
      console.error('Failed to update balance:', error);
      userBalanceElement.textContent = 'Balance: 0 DCT';
    }
  }, [dht]);

  const updateTransactionHistory = useCallback(async () => {
    const transactionList = document.getElementById('transactionList');
    if (!transactionList) return;

    if (!dht) {
      transactionList.innerHTML = 'Not initialized.';
      return;
    }

    try {
      const transactions = await dht.dbGetAll('transactions');
      if (transactions.length === 0) {
        transactionList.innerHTML = 'No transactions yet.';
        return;
      }
      transactionList.innerHTML = transactions
        .map((tx) => `<p class="py-1">${tx.type} - ${tx.amount} DCT - ${new Date(tx.timestamp).toLocaleString()}</p>`)
        .join('');
    } catch (error) {
      console.error('Failed to update transaction history:', error);
      transactionList.innerHTML = 'Failed to load transactions.';
    }
  }, [dht]);

  const updateLiveFeed = useCallback(async () => {
    const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
    if (!publishedItemsTableBody) return;

    publishedItemsTableBody.innerHTML = '';
    try {
      const snippetsQuery = query(collection(window.db, 'snippets'), where('reviewStatus', '==', 'active'));
      onSnapshot(snippetsQuery, async (snapshots) => {
        const snippetsData = {};
        snapshots.forEach((doc) => {
          snippetsData[doc.id] = doc.data();
        });

        if (dht) {
          dht.knownObjects.clear();
          for (const [ipHash, data] of Object.entries(snippetsData)) {
            const metadata = {
              content_type: data.ipHash,
              description: data.description || 'No description',
              tags: data.tags || [],
              isPremium: data.isPremium || false,
              priceUsd: data.priceUsd || 0,
            };
            dht.knownObjects.set(ipHash, { metadata, chunks: data.chunks || [] });
            await dht.broadcastIP(ipHash, metadata, data.chunks || []);
          }

          dht.knownObjects.forEach((value, key) => {
            const snippetInfo = snippetsData[key] || { likes: 0, dislikes: 0, reviewStatus: 'active' };
            if (snippetInfo.reviewStatus !== 'active') return;

            const isPremium = value.metadata.isPremium || false;
            const priceUsd = isPremium ? (value.metadata.priceUsd || 0) : 0;
            const costDisplay = priceUsd > 0 ? `${priceUsd} DCT` : 'Free';
            const row = document.createElement('tr');
            row.innerHTML = `
              <td class="py-2 px-4">${value.metadata.content_type}</td>
              <td class="py-2 px-4">${value.metadata.description || 'No description'}</td>
              <td class="py-2 px-4">${value.metadata.tags.join(', ') || 'No tags'}</td>
              <td class="py-2 px-4">${snippetInfo.likes}</td>
              <td class="py-2 px-4">${snippetInfo.dislikes}</td>
              <td class="py-2 px-4">
                <button onclick="window.buySnippet('${key}')" class="bg-purple-500 text-white rounded hover:bg-purple-600 px-3 py-1 mr-2">Get (${costDisplay})</button>
                <button onclick="window.flagSnippet('${key}')" class="bg-red-500 text-white rounded hover:bg-red-600 px-3 py-1">Flag</button>
              </td>
            `;
            publishedItemsTableBody.appendChild(row);
          });
        }
      });
    } catch (error) {
      console.error('Failed to update live feed:', error);
      throw error;
    }
  }, [dht]);

  const updateMySnippets = useCallback(async () => {
    const mySnippetsTableBody = document.getElementById('mySnippets')?.querySelector('tbody');
    if (!mySnippetsTableBody) return;

    mySnippetsTableBody.innerHTML = '';
    try {
      const userId = user?.uid || localStorage.getItem('nodeId');
      if (!userId) return;

      const snippetsQuery = query(collection(window.db, 'snippets'), where('creatorId', '==', userId));
      const snippetsSnapshot = await getDocs(snippetsQuery);
      snippetsSnapshot.forEach((doc) => {
        const data = doc.data();
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="py-2 px-4">${data.ipHash}</td>
          <td class="py-2 px-4">${data.ipHash || 'No title'}</td>
          <td class="py-2 px-4">
            <button onclick="window.copyHash('${data.ipHash}')" class="bg-blue-500 text-white rounded hover:bg-blue-600 px-3 py-1">Copy Hash</button>
          </td>
        `;
        mySnippetsTableBody.appendChild(row);
      });
    } catch (error) {
      console.error('Failed to update my snippets:', error);
      throw error;
    }
  }, [user]);

  const searchSnippets = useCallback(async (searchTerm) => {
    const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
    if (!publishedItemsTableBody) return;

    publishedItemsTableBody.innerHTML = '';
    try {
      const searchTags = searchTerm.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag);
      let snippetsSnapshot;

      if (searchTags.length === 0) {
        snippetsSnapshot = await getDocs(query(collection(window.db, 'snippets'), where('reviewStatus', '==', 'active')));
      } else {
        snippetsSnapshot = await getDocs(query(collection(window.db, 'snippets'), where('reviewStatus', '==', 'active')));
      }

      const snippetsData = {};
      snippetsSnapshot.forEach((doc) => {
        snippetsData[doc.id] = doc.data();
      });

      if (dht) {
        dht.knownObjects.clear();
        for (const [ipHash, data] of Object.entries(snippetsData)) {
          const metadata = {
            content_type: data.ipHash,
            description: data.description || 'No description',
            tags: data.tags || [],
            isPremium: data.isPremium || false,
            priceUsd: data.priceUsd || 0,
          };
          dht.knownObjects.set(ipHash, { metadata, chunks: data.chunks || [] });
        }

        dht.knownObjects.forEach((value, key) => {
          const snippetInfo = snippetsData[key] || { likes: 0, dislikes: 0, reviewStatus: 'active' };
          if (snippetInfo.reviewStatus !== 'active') return;

          const tags = (value.metadata.tags || []).map(tag => tag.toLowerCase());
          if (searchTags.length > 0 && !searchTags.some(tag => tags.includes(tag))) return;

          const isPremium = value.metadata.isPremium || false;
          const priceUsd = isPremium ? (value.metadata.priceUsd || 0) : 0;
          const costDisplay = priceUsd > 0 ? `${priceUsd} DCT` : 'Free';
          const row = document.createElement('tr');
          row.innerHTML = `
            <td class="py-2 px-4">${value.metadata.content_type}</td>
            <td class="py-2 px-4">${value.metadata.description || 'No description'}</td>
            <td class="py-2 px-4">${value.metadata.tags.join(', ') || 'No tags'}</td>
            <td class="py-2 px-4">${snippetInfo.likes}</td>
            <td class="py-2 px-4">${snippetInfo.dislikes}</td>
            <td class="py-2 px-4">
              <button onclick="window.buySnippet('${key}')" class="bg-purple-500 text-white rounded hover:bg-purple-600 px-3 py-1 mr-2">Get (${costDisplay})</button>
              <button onclick="window.flagSnippet('${key}')" class="bg-red-500 text-white rounded hover:bg-red-600 px-3 py-1">Flag</button>
            </td>
          `;
          publishedItemsTableBody.appendChild(row);
        });
      }
    } catch (error) {
      console.error('Failed to search snippets:', error);
      throw error;
    }
  }, [dht]);

  const publishSnippet = useCallback(async (title, description, tags, content, fileInput) => {
    if (!isAuthenticated()) throw new Error('Please sign in to publish.');
    if (!dht) throw new Error('DHT not initialized');
    if (!title) throw new Error('Title is required');

    let finalContent = content || '';
    let fileType = 'text/plain';
    if (fileInput?.files?.length) {
      const file = fileInput.files[0];
      fileType = file.type || 'application/octet-stream';
      finalContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(new Uint8Array(e.target.result));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
      });
    } else {
      finalContent = new TextEncoder().encode(finalContent);
    }

    const isPremium = document.getElementById('modalPremium').checked;
    const priceInput = document.getElementById('modalPriceInput');
    const priceUsd = isPremium && priceInput ? parseFloat(priceInput.value) || 0 : 0;

    const metadata = {
      content_type: fileType,
      title: title,
      description: description || '',
      tags: tags ? tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0) : [],
      isPremium: isPremium,
      priceUsd: priceUsd,
    };

    const ipHash = await dht.publishIP(metadata, finalContent, fileType);
    const userId = user?.uid || localStorage.getItem('nodeId');
    const snippetRef = doc(window.db, 'snippets', ipHash);

    const snippetData = {
      ipHash: ipHash,
      title: title,
      description: description || '',
      tags: metadata.tags,
      isPremium: isPremium,
      priceUsd: priceUsd,
      flagCount: 0,
      likes: 0,
      dislikes: 0,
      createdAt: Date.now(),
      creatorId: userId,
    };

    await setDoc(snippetRef, snippetData, { merge: true });

    const userRef = doc(window.db, 'users', userId);
    await updateDoc(userRef, {
      snippetsPosted: increment(1)
    });

    await Promise.all([
      updateLiveFeed(),
      updateMySnippets(),
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
      updateUserProfile(userId),
    ]);
  }, [dht, user, updateLiveFeed, updateMySnippets, updateTransactionHistory, updateBalanceDisplay]);

  const buySnippet = useCallback(async (hash) => {
    if (!isAuthenticated()) throw new Error('Please sign in to buy.');
    if (!dht) throw new Error('DHT not initialized');
    if (!hash) throw new Error('Hash is required');

    let ipObject = dht.knownObjects.get(hash);
    if (!ipObject) {
      const snippetRef = doc(window.db, 'snippets', hash);
      const snippetSnap = await getDoc(snippetRef);
      if (!snippetSnap.exists()) throw new Error('Snippet not found');

      const data = snippetSnap.data();
      ipObject = {
        metadata: {
          content_type: data.ipHash,
          description: data.description || 'No description',
          tags: data.tags || [],
          isPremium: data.isPremium || false,
          priceUsd: data.priceUsd || 0,
        },
        chunks: data.chunks || [],
      };
      dht.knownObjects.set(hash, ipObject);
      await dht.broadcastIP(hash, ipObject.metadata, ipObject.chunks);
    }

    const isPremium = ipObject.metadata.isPremium || false;
    const priceUsd = isPremium ? (ipObject.metadata.priceUsd || 0) : 0;
    const buyCost = priceUsd;

    if (buyCost > 0) {
      const balance = await dht.getBalance(dht.keypair);
      if (balance < buyCost) throw new Error('Insufficient balance');

      const commission = buyCost * 0.05;
      await dht.distributeCommission(commission);
      await dht.putBalance(dht.keypair, balance - buyCost);
      await dht.dbAdd('transactions', { type: 'buy', amount: buyCost, timestamp: Date.now() });
    } else {
      await dht.dbAdd('transactions', { type: 'buy', amount: 0, timestamp: Date.now() });
    }

    const { data, fileType } = await dht.requestData(hash);

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
      updateMySnippets(),
    ]);

    const feedback = prompt('Do you like this snippet? Type "like" or "dislike":');
    if (feedback !== null) {
      const action = feedback.trim().toLowerCase();
      if (action === 'like' || action === 'dislike') {
        await submitFeedback(hash, action);
        await updateLiveFeed();
      }
    }

    displaySnippetContent(data, fileType, ipObject.metadata.content_type);
    return { data, fileType };
  }, [dht, isAuthenticated, updateTransactionHistory, updateBalanceDisplay, updateMySnippets, updateLiveFeed]);

  const buySnippetByHash = useCallback(async (hash) => {
    if (!hash) throw new Error('Please enter a valid hash.');
    const result = await buySnippet(hash);
    if (result) console.log('Snippet purchased and displayed below!');
  }, [buySnippet]);

  const flagSnippet = useCallback(async (ipHash) => {
    const userId = user?.uid || localStorage.getItem('nodeId');
    if (!userId) throw new Error('Please sign in to flag content.');

    try {
      const snippetRef = doc(window.db, 'snippets', ipHash);
      await updateDoc(snippetRef, { flagCount: increment(1) });

      const snippetSnap = await getDoc(snippetRef);
      const flagCount = snippetSnap.data().flagCount || 0;

      if (flagCount >= 3) {
        await updateDoc(snippetRef, { reviewStatus: 'under_review' });
        await updateLiveFeed();
      }
    } catch (error) {
      console.error('Failed to flag snippet:', error);
      throw error;
    }
  }, [user, updateLiveFeed]);

  const deposit = useCallback(async (amount) => {
    if (!isAuthenticated()) throw new Error('Please sign in to deposit.');
    if (!dht) throw new Error('DHT not initialized');
    if (!amount || amount <= 0) throw new Error('Invalid deposit amount');

    const balance = await dht.getBalance(dht.keypair);
    const newBalance = balance + amount;
    await dht.putBalance(dht.keypair, newBalance);
    await dht.dbAdd('transactions', { type: 'deposit', amount, timestamp: Date.now() });

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
    ]);
  }, [dht, isAuthenticated, updateTransactionHistory, updateBalanceDisplay]);

  const withdraw = useCallback(async (amount) => {
    if (!isAuthenticated()) throw new Error('Please sign in to withdraw.');
    if (!dht) throw new Error('DHT not initialized');
    if (!amount || amount <= 0) throw new Error('Invalid withdrawal amount');

    const balance = await dht.getBalance(dht.keypair);
    if (balance < amount) throw new Error('Insufficient balance');

    await dht.putBalance(dht.keypair, balance - amount);
    await dht.dbAdd('transactions', { type: 'withdraw', amount, timestamp: Date.now() });

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
    ]);
  }, [dht, isAuthenticated, updateTransactionHistory, updateBalanceDisplay]);

  const copyHash = useCallback(async (hash) => {
    try {
      await navigator.clipboard.writeText(hash);
    } catch (error) {
      console.error('Failed to copy hash:', error);
      throw error;
    }
  }, []);

  const displaySnippetContent = (data, fileType, title) => {
    const snippetDisplay = document.getElementById('snippetDisplay');
    if (!snippetDisplay) return;

    snippetDisplay.innerHTML = '';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'p-4 bg-gray-800 rounded-lg mt-4';

    const titleElement = document.createElement('h3');
    titleElement.className = 'text-lg font-semibold mb-2';
    titleElement.textContent = title || 'Snippet Content';
    contentDiv.appendChild(titleElement);

    if (fileType.startsWith('text')) {
      const text = new TextDecoder().decode(data);
      const pre = document.createElement('pre');
      pre.className = 'text-sm text-gray-300 whitespace-pre-wrap';
      pre.textContent = text;
      contentDiv.appendChild(pre);
    } else if (fileType.startsWith('image')) {
      const blob = new Blob([data], { type: fileType });
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = url;
      img.className = 'max-w-full h-auto rounded';
      img.onload = () => URL.revokeObjectURL(url);
      contentDiv.appendChild(img);
    } else {
      const blob = new Blob([data], { type: fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = title || 'downloaded_file';
      a.className = 'text-blue-400 hover:underline';
      a.textContent = 'Download File';
      a.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 1000);
      contentDiv.appendChild(a);
    }

    snippetDisplay.appendChild(contentDiv);
  };

  const uploadUserDataToFirebase = async () => {
    const userId = user?.uid || localStorage.getItem('nodeId');
    if (!userId) return;

    try {
      const userRef = doc(window.db, 'users', userId);
      const balance = dht ? await dht.getBalance(dht.keypair) : 0;
      await setDoc(userRef, { balance, lastUpdated: Date.now() }, { merge: true });
    } catch (error) {
      console.error('Failed to upload user data to Firebase:', error);
    }
  };

  const updateUserProfile = async (userId) => {
    if (!userId) return;
    try {
      const userRef = doc(window.db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const userNameElement = document.getElementById('userName');
        const userAvatarElement = document.querySelector('.user-avatar');
        const snippetsPostedElement = document.getElementById('snippetsPosted');

        if (userNameElement) {
          userNameElement.textContent = userData.username || 'Anonymous User';
        }
        if (userAvatarElement) {
          if (userData.profileImageUrl) {
            userAvatarElement.innerHTML = `<img src="${userData.profileImageUrl}" alt="Profile Image" class="w-12 h-12 rounded-full object-cover">`;
          } else {
            userAvatarElement.innerHTML = '<i class="fas fa-user text-lg"></i>';
          }
        }
        if (snippetsPostedElement) {
          snippetsPostedElement.textContent = userData.snippetsPosted || 0;
        }
      }
    } catch (error) {
      console.error('Failed to fetch user profile:', error);
      throw error;
    }
  };

  const submitFeedback = async (ipHash, action) => {
    const userId = user?.uid || localStorage.getItem('nodeId');
    if (!userId) return;

    try {
      const feedbackRef = doc(window.db, 'snippets', ipHash, 'feedback', userId);
      await setDoc(feedbackRef, { action, timestamp: Date.now() });

      const snippetRef = doc(window.db, 'snippets', ipHash);
      if (action === 'like') {
        await updateDoc(snippetRef, { likes: increment(1) });
      } else if (action === 'dislike') {
        await updateDoc(snippetRef, { dislikes: increment(1) });
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      throw error;
    }
  };

  window.buySnippet = buySnippet;
  window.flagSnippet = flagSnippet;
  window.copyHash = copyHash;

  return {
    dht,
    updateBalanceDisplay,
    updateTransactionHistory,
    updateLiveFeed,
    updateMySnippets,
    searchSnippets,
    publishSnippet,
    buySnippet,
    buySnippetByHash,
    flagSnippet,
    deposit,
    withdraw,
    copyHash,
  };
};