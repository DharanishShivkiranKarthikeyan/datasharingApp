import { useState, useCallback, useEffect } from 'react';
import { doc, getDocs, setDoc, updateDoc, increment, query, where, onSnapshot, collection } from 'firebase/firestore';
import { db } from '../firebase.js';

export const useDHT = (user) => {
  const [dht, setDht] = useState(null); // Initialize as null instead of window.dht to avoid stale references

  useEffect(() => {
    console.log('useDHT effect triggered with user:', user?.uid);
    if (!user) {
      console.log('No user provided, skipping DHT initialization');
      return;
    }

    if (window.dht) {
      console.log('window.dht found, setting DHT');
      setDht(window.dht);
    } else {
      console.log('window.dht not found, starting polling');
      const checkDht = setInterval(() => {
        if (window.dht) {
          console.log('window.dht became available, setting DHT');
          setDht(window.dht);
          clearInterval(checkDht);
        }
      }, 100); // Check every 100ms

      // Cleanup interval on unmount or user change
      return () => {
        console.log('Cleaning up useDHT effect');
        clearInterval(checkDht);
      };
    }
  }, [user]); // Only depend on user, not dht, to avoid infinite loops

  const updateBalanceDisplay = useCallback(async () => {
    const userBalanceElement = document.getElementById('userBalance');
    if (!userBalanceElement) {
      console.log('userBalance element not found');
      return;
    }

    if (!dht) {
      userBalanceElement.textContent = 'Balance: 0 DCT';
      console.log('DHT not initialized, setting balance to 0');
      return;
    }

    try {
      const userBalance = (await dht.getBalance(dht.keypair)) || 0;
      userBalanceElement.textContent = `Balance: ${userBalance} DCT`;
      console.log('Updated balance:', userBalance);
    } catch (error) {
      console.error('Failed to update balance:', error);
      userBalanceElement.textContent = 'Balance: 0 DCT';
    }
  }, [dht]);

  const updateTransactionHistory = useCallback(async () => {
    const transactionList = document.getElementById('transactionList');
    if (!transactionList) {
      console.log('transactionList element not found');
      return;
    }

    if (!dht) {
      transactionList.innerHTML = 'Not initialized.';
      console.log('DHT not initialized, setting transaction list to Not initialized');
      return;
    }

    try {
      const transactions = await dht.dbGetAll('transactions');
      if (transactions.length === 0) {
        transactionList.innerHTML = 'No transactions yet.';
        console.log('No transactions found');
        return;
      }
      transactionList.innerHTML = transactions
        .map((tx) => `<p class="py-1">${tx.type} - ${tx.amount} DCT - ${new Date(tx.timestamp).toLocaleString()}</p>`)
        .join('');
      console.log('Updated transaction history with', transactions.length, 'transactions');
    } catch (error) {
      console.error('Failed to update transaction history:', error);
      transactionList.innerHTML = 'Failed to load transactions.';
    }
  }, [dht]);

  const updateLiveFeed = useCallback(async () => {
    const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
    if (!publishedItemsTableBody) {
      console.log('publishedItems table body not found');
      return;
    }

    publishedItemsTableBody.innerHTML = '';
    try {
      const snippetsQuery = query(collection(db, 'snippets'), where('reviewStatus', '==', 'active'));
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
          console.log('Updated live feed with', dht.knownObjects.size, 'snippets');
        }
      });
    } catch (error) {
      console.error('Failed to update live feed:', error);
      publishedItemsTableBody.innerHTML = '<tr><td colspan="6">Failed to load snippets.</td></tr>';
    }
  }, [dht]);

  const updateMySnippets = useCallback(async () => {
    const mySnippetsTableBody = document.getElementById('mySnippets')?.querySelector('tbody');
    if (!mySnippetsTableBody) {
      console.log('mySnippets table body not found');
      return;
    }

    mySnippetsTableBody.innerHTML = '';
    if (!user?.uid) {
      console.log('No user ID, skipping mySnippets update');
      return;
    }

    try {
      const snippetsQuery = query(collection(db, 'snippets'), where('creatorId', '==', user.uid));
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
      console.log('Updated my snippets with', snippetsSnapshot.size, 'items');
    } catch (error) {
      console.error('Failed to update my snippets:', error);
      mySnippetsTableBody.innerHTML = '<tr><td colspan="3">Failed to load snippets.</td></tr>';
    }
  }, [user]);

  const searchSnippets = useCallback(async (searchTerm) => {
    const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
    if (!publishedItemsTableBody) {
      console.log('publishedItems table body not found for search');
      return;
    }

    publishedItemsTableBody.innerHTML = '';
    try {
      const searchTags = searchTerm.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag);
      let snippetsSnapshot;

      if (searchTags.length === 0) {
        snippetsSnapshot = await getDocs(query(collection(db, 'snippets'), where('reviewStatus', '==', 'active')));
      } else {
        snippetsSnapshot = await getDocs(query(collection(db, 'snippets'), where('reviewStatus', '==', 'active')));
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
        console.log('Searched snippets with term:', searchTerm);
      }
    } catch (error) {
      console.error('Failed to search snippets:', error);
      publishedItemsTableBody.innerHTML = '<tr><td colspan="6">Failed to load snippets.</td></tr>';
    }
  }, [dht]);

  const publishSnippet = useCallback(async (title, description, tags, content, fileInput) => {
    if (!user?.uid) {
      console.log('No authenticated user, cannot publish snippet');
      throw new Error('Please sign in to publish.');
    }
    if (!dht) {
      console.log('DHT not initialized, cannot publish snippet');
      throw new Error('DHT not initialized');
    }
    if (!title) {
      console.log('Title is required for publishing');
      throw new Error('Title is required');
    }

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

    const isPremium = document.getElementById('modalPremium')?.checked;
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
    const userId = user.uid;
    const snippetRef = doc(db, 'snippets', ipHash);

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

    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      snippetsPosted: increment(1)
    });

    await Promise.all([
      updateLiveFeed(),
      updateMySnippets(),
      updateTransactionHistory(),
      updateBalanceDisplay(),
    ]);
    console.log('Published snippet with hash:', ipHash);
  }, [dht, user, updateLiveFeed, updateMySnippets, updateTransactionHistory, updateBalanceDisplay]);

  const buySnippet = useCallback(async (hash) => {
    if (!user?.uid) {
      console.log('No authenticated user, cannot buy snippet');
      throw new Error('Please sign in to buy.');
    }
    if (!dht) {
      console.log('DHT not initialized, cannot buy snippet');
      throw new Error('DHT not initialized');
    }
    if (!hash) {
      console.log('Hash is required for buying snippet');
      throw new Error('Hash is required');
    }

    let ipObject = dht.knownObjects.get(hash);
    if (!ipObject) {
      const snippetRef = doc(db, 'snippets', hash);
      const snippetSnap = await getDoc(snippetRef);
      if (!snippetSnap.exists()) {
        console.log('Snippet not found for hash:', hash);
        throw new Error('Snippet not found');
      }

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
      if (balance < buyCost) {
        console.log('Insufficient balance:', balance, 'for cost:', buyCost);
        throw new Error('Insufficient balance');
      }

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
    console.log('Bought snippet with hash:', hash);
    return { data, fileType };
  }, [dht, user, updateTransactionHistory, updateBalanceDisplay, updateMySnippets, updateLiveFeed]);

  const buySnippetByHash = useCallback(async (hash) => {
    if (!hash) {
      console.log('Invalid hash for buySnippetByHash');
      throw new Error('Please enter a valid hash.');
    }
    const result = await buySnippet(hash);
    if (result) console.log('Snippet purchased and displayed below!');
  }, [buySnippet]);

  const flagSnippet = useCallback(async (ipHash) => {
    if (!user?.uid) {
      console.log('No authenticated user, cannot flag snippet');
      throw new Error('Please sign in to flag content.');
    }

    try {
      const snippetRef = doc(db, 'snippets', ipHash);
      await updateDoc(snippetRef, { flagCount: increment(1) });

      const snippetSnap = await getDoc(snippetRef);
      const flagCount = snippetSnap.data().flagCount || 0;

      if (flagCount >= 3) {
        await updateDoc(snippetRef, { reviewStatus: 'under_review' });
        await updateLiveFeed();
      }
      console.log('Flagged snippet with hash:', ipHash);
    } catch (error) {
      console.error('Failed to flag snippet:', error);
      throw error;
    }
  }, [user, updateLiveFeed]);

  const deposit = useCallback(async (amount) => {
    if (!user?.uid) {
      console.log('No authenticated user, cannot deposit');
      throw new Error('Please sign in to deposit.');
    }
    if (!dht) {
      console.log('DHT not initialized, cannot deposit');
      throw new Error('DHT not initialized');
    }
    if (!amount || amount <= 0) {
      console.log('Invalid deposit amount:', amount);
      throw new Error('Invalid deposit amount');
    }

    const balance = await dht.getBalance(dht.keypair);
    const newBalance = balance + amount;
    await dht.putBalance(dht.keypair, newBalance);
    await dht.dbAdd('transactions', { type: 'deposit', amount, timestamp: Date.now() });

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
    ]);
    console.log('Deposited amount:', amount);
  }, [dht, user, updateTransactionHistory, updateBalanceDisplay]);

  const withdraw = useCallback(async (amount) => {
    if (!user?.uid) {
      console.log('No authenticated user, cannot withdraw');
      throw new Error('Please sign in to withdraw.');
    }
    if (!dht) {
      console.log('DHT not initialized, cannot withdraw');
      throw new Error('DHT not initialized');
    }
    if (!amount || amount <= 0) {
      console.log('Invalid withdrawal amount:', amount);
      throw new Error('Invalid withdrawal amount');
    }

    const balance = await dht.getBalance(dht.keypair);
    if (balance < amount) {
      console.log('Insufficient balance:', balance, 'for withdrawal:', amount);
      throw new Error('Insufficient balance');
    }

    await dht.putBalance(dht.keypair, balance - amount);
    await dht.dbAdd('transactions', { type: 'withdraw', amount, timestamp: Date.now() });

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
    ]);
    console.log('Withdrew amount:', amount);
  }, [dht, user, updateTransactionHistory, updateBalanceDisplay]);

  const copyHash = useCallback(async (hash) => {
    try {
      await navigator.clipboard.writeText(hash);
      console.log('Copied hash:', hash);
    } catch (error) {
      console.error('Failed to copy hash:', error);
      throw error;
    }
  }, []);

  const displaySnippetContent = (data, fileType, title) => {
    const snippetDisplay = document.getElementById('snippetDisplay');
    if (!snippetDisplay) {
      console.log('snippetDisplay element not found');
      return;
    }

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

  const submitFeedback = async (ipHash, action) => {
    if (!user?.uid) {
      console.log('No authenticated user, cannot submit feedback');
      return;
    }

    try {
      const feedbackRef = doc(db, 'snippets', ipHash, 'feedback', user.uid);
      await setDoc(feedbackRef, { action, timestamp: Date.now() });

      const snippetRef = doc(db, 'snippets', ipHash);
      if (action === 'like') {
        await updateDoc(snippetRef, { likes: increment(1) });
      } else if (action === 'dislike') {
        await updateDoc(snippetRef, { dislikes: increment(1) });
      }
      console.log('Submitted feedback:', action, 'for hash:', ipHash);
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