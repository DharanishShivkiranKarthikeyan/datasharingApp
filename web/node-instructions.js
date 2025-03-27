import { DHT } from './dht.js';
import { collection, getDocs, doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { db } from './firebase.js';

if (window.location.pathname === '/datasharingApp/node-instructions.html' || window.location.pathname === '/node-instructions.html') {
  let dht;
  let currentChatPeerId = null;
  let currentChatUsername = null;
  let currentChatType = 'direct';
  let currentGroupId = null;
  let currentGroupParticipants = [];
  let currentGroupUsernames = {};

  document.addEventListener('DOMContentLoaded', async () => {
    showLoading(true);
    try {
      const nodeId = localStorage.getItem('nodeId');
      const role = localStorage.getItem('role');

      if (role !== 'node' || !nodeId) {
        showToast('You must be signed in as a node to view this page.');
        window.location.href = '/datasharingApp/signup.html';
        return;
      }

      const encoder = new TextEncoder();
      const keypair = encoder.encode(nodeId);

      dht = new DHT(keypair, true);
      await dht.initDB();
      await dht.initSwarm();
      await dht.syncUserData();

      const nodeCount = await dht.getNodeCount();
      console.log(`DHT currently has ${nodeCount} nodes`);

      const transactions = await dht.dbGetAll('transactions');
      const commissionEarnings = transactions
        .filter(tx => tx.type === 'commission')
        .reduce((total, tx) => total + (tx.amount || 0), 0);

      const nodeEarningsElement = document.getElementById('nodeEarnings');
      if (nodeEarningsElement) {
        nodeEarningsElement.textContent = `Total Earnings: ${commissionEarnings.toFixed(2)} DCT`;
      }

      const chatContacts = document.getElementById('chatContacts');
      const chatWindow = document.getElementById('chatWindow');
      const chatInput = document.getElementById('chatInput');
      const sendChatButton = document.getElementById('sendChatButton');
      const createGroupButton = document.getElementById('createGroupButton');
      const chatList = document.getElementById('chatList');
      const inviteButton = document.getElementById('inviteButton');
      const leaveGroupButton = document.getElementById('leaveGroupButton');

      const userDirectory = await fetchUserDirectory();
      userDirectory.forEach(contact => {
        if (contact.peerId !== dht.peer.id) {
          const li = document.createElement('li');
          li.className = 'p-2 bg-gray-600 rounded cursor-pointer hover:bg-gray-500';
          li.textContent = `${contact.username} (${contact.type})`;
          li.onclick = () => startDirectChat(contact.peerId, contact.username);
          chatContacts.appendChild(li);
        }
      });

      sendChatButton.addEventListener('click', sendDirectMessage);
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendDirectMessage();
      });
      createGroupButton.addEventListener('click', createGroupChat);
      if (inviteButton) inviteButton.addEventListener('click', inviteToGroup);
      if (leaveGroupButton) leaveGroupButton.addEventListener('click', leaveGroup);
      sendChatButton.disabled = false;
      createGroupButton.disabled = false;
      loadGroupChats();
    } catch (error) {
      console.error('Error initializing node instructions:', error);
      showToast(`Initialization failed: ${error.message}`);
    } finally {
      showLoading(false);
    }
  });

  async function fetchUserDirectory() {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const nodesSnapshot = await getDocs(collection(db, 'nodes'));
    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      type: 'user',
      peerId: `user-${doc.id}`,
      username: doc.data().username || 'Anonymous',
      ...doc.data()
    }));
    const nodes = nodesSnapshot.docs.map(doc => ({
      id: doc.id,
      type: 'node',
      peerId: `node-${doc.id}`,
      username: doc.data().username || 'Anonymous',
      ...doc.data()
    }));
    return [...users, ...nodes];
  }

  async function createGroupChat() {
    const groupName = prompt('Enter group name:');
    if (!groupName) return;

    const groupId = generateUUID();
    const peerId = dht.peer.id;
    const nodeId = localStorage.getItem('nodeId');
    const nodeDoc = await getDoc(doc(db, 'nodes', nodeId));
    const username = nodeDoc.exists() ? nodeDoc.data().username : 'Anonymous';

    await setDoc(doc(db, 'chat_groups', groupId), {
      name: groupName,
      participants: [peerId],
      participantIds: [nodeId],
      participantUsernames: [username],
      createdAt: Date.now()
    });
    showToast('Group created successfully!');
    loadGroupChats();
  }

  async function loadGroupChats() {
    const chatList = document.getElementById('chatList');
    while (chatList.children.length > 1) {
      chatList.removeChild(chatList.lastChild);
    }

    const groupChatsSnapshot = await getDocs(collection(db, 'chat_groups'));
    groupChatsSnapshot.forEach(doc => {
      const group = doc.data();
      const li = document.createElement('li');
      li.className = 'p-2 bg-gray-600 rounded cursor-pointer hover:bg-gray-500';
      li.textContent = `Group: ${group.name} (${group.participants.length} members)`;
      li.onclick = () => startGroupChat(doc.id, group.name, group.participants, group.participantUsernames);
      chatList.appendChild(li);
    });
  }

  async function startGroupChat(groupId, groupName, participants, participantUsernames) {
    currentChatType = 'group';
    currentChatPeerId = null;
    currentGroupId = groupId;
    currentGroupParticipants = participants;
    currentGroupUsernames = participantUsernames.reduce((acc, username, index) => {
      acc[participants[index]] = username;
      return acc;
    }, {});
    const chatId = `group-${groupId}`;
    const chatWindow = document.getElementById('chatWindow');
    const inviteButton = document.getElementById('inviteButton');
    const leaveGroupButton = document.getElementById('leaveGroupButton');
    chatWindow.innerHTML = `<h3>${groupName}</h3><p>Members: ${participantUsernames.join(', ')}</p>`;
    if (inviteButton) inviteButton.classList.remove('hidden');
    if (leaveGroupButton) leaveGroupButton.classList.remove('hidden');

    const messages = await dht.getChatMessages(chatId);
    messages.forEach(displayChatMessage);

    dht.onChatMessage(chatId, (message) => {
      displayChatMessage(message);
    });

    if (!participants.includes(dht.peer.id)) {
      const nodeId = localStorage.getItem('nodeId');
      const nodeDoc = await getDoc(doc(db, 'nodes', nodeId));
      const username = nodeDoc.exists() ? nodeDoc.data().username : 'Anonymous';
      await updateDoc(doc(db, 'chat_groups', groupId), {
        participants: arrayUnion(dht.peer.id),
        participantIds: arrayUnion(nodeId),
        participantUsernames: arrayUnion(username)
      });
      currentGroupParticipants.push(dht.peer.id);
      currentGroupUsernames[dht.peer.id] = username;
    }
  }

  async function startDirectChat(peerId, username) {
    currentChatType = 'direct';
    currentChatPeerId = peerId;
    currentChatUsername = username;
    currentGroupId = null;
    currentGroupParticipants = [];
    currentGroupUsernames = {};
    const chatId = `direct-${peerId}`;
    const chatWindow = document.getElementById('chatWindow');
    const inviteButton = document.getElementById('inviteButton');
    const leaveGroupButton = document.getElementById('leaveGroupButton');
    chatWindow.innerHTML = `<h3>Chat with ${username}</h3>`;
    if (inviteButton) inviteButton.classList.add('hidden');
    if (leaveGroupButton) leaveGroupButton.classList.add('hidden');

    const messages = await dht.getChatMessages(chatId);
    messages.forEach(displayChatMessage);

    dht.onChatMessage(chatId, (message) => {
      displayChatMessage(message);
    });
  }

  async function sendDirectMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    if (!message) return;

    const nodeId = localStorage.getItem('nodeId');
    const nodeDoc = await getDoc(doc(db, 'nodes', nodeId));
    const username = nodeDoc.exists() ? nodeDoc.data().username : 'Anonymous';

    if (currentChatType === 'direct' && currentChatPeerId) {
      await dht.sendChatMessage(currentChatPeerId, message, 'direct', null, username);
    } else if (currentChatType === 'group' && currentGroupId) {
      for (const peerId of currentGroupParticipants) {
        if (peerId !== dht.peer.id) {
          await dht.sendChatMessage(peerId, message, 'group', currentGroupId, username);
        }
      }
    }
    chatInput.value = '';
  }

  function displayChatMessage(message) {
    const chatWindow = document.getElementById('chatWindow');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'mb-2';
    const fromSelf = message.from === dht.peer.id;
    messageDiv.className += fromSelf ? ' text-right' : ' text-left';
    const senderUsername = message.username || (fromSelf ? 'You' : currentChatUsername || currentGroupUsernames[message.from]) || 'Anonymous';
    messageDiv.innerHTML = `<span class="${fromSelf ? 'text-blue-300' : 'text-green-300'}">${senderUsername}</span>: ${message.message}`;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function showDirectChats() {
    currentChatType = 'direct';
    currentGroupId = null;
    currentGroupParticipants = [];
    currentGroupUsernames = {};
    const chatContacts = document.getElementById('chatContacts');
    const chatWindow = document.getElementById('chatWindow');
    const inviteButton = document.getElementById('inviteButton');
    const leaveGroupButton = document.getElementById('leaveGroupButton');
    chatContacts.classList.remove('hidden');
    chatWindow.innerHTML = '';
    if (inviteButton) inviteButton.classList.add('hidden');
    if (leaveGroupButton) leaveGroupButton.classList.add('hidden');
  }

  async function inviteToGroup() {
    if (currentChatType !== 'group' || !currentGroupId) return;

    const usernameToInvite = prompt('Enter the username to invite:');
    if (!usernameToInvite) return;

    const userDirectory = await fetchUserDirectory();
    const userToInvite = userDirectory.find(user => user.username === usernameToInvite);
    if (!userToInvite) {
      showToast('User not found.', true);
      return;
    }

    const groupDoc = await getDoc(doc(db, 'chat_groups', currentGroupId));
    if (!groupDoc.exists()) return;

    const groupData = groupDoc.data();
    if (groupData.participants.includes(userToInvite.peerId)) {
      showToast('User is already in the group.', true);
      return;
    }

    await updateDoc(doc(db, 'chat_groups', currentGroupId), {
      participants: arrayUnion(userToInvite.peerId),
      participantIds: arrayUnion(userToInvite.id),
      participantUsernames: arrayUnion(userToInvite.username)
    });

    currentGroupParticipants.push(userToInvite.peerId);
    currentGroupUsernames[userToInvite.peerId] = userToInvite.username;
    showToast(`Invited ${usernameToInvite} to the group!`);
    startGroupChat(currentGroupId, groupData.name, [...groupData.participants, userToInvite.peerId], [...groupData.participantUsernames, userToInvite.username]);
  }

  async function leaveGroup() {
    if (currentChatType !== 'group' || !currentGroupId) return;

    const peerId = dht.peer.id;
    const nodeId = localStorage.getItem('nodeId');
    const nodeDoc = await getDoc(doc(db, 'nodes', nodeId));
    const username = nodeDoc.exists() ? nodeDoc.data().username : 'Anonymous';

    await updateDoc(doc(db, 'chat_groups', currentGroupId), {
      participants: arrayRemove(peerId),
      participantIds: arrayRemove(nodeId),
      participantUsernames: arrayRemove(username)
    });

    showToast('You have left the group.');
    showDirectChats();
    loadGroupChats();
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }

  function showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = show ? 'flex' : 'none';
  }
}