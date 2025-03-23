export function showLoading(state) {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = state ? 'flex' : 'none';
  }
  
  export function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => toast.style.display = 'none', 3000);
    }
  }