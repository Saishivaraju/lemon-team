
    (function () {
      const sess = JSON.parse(localStorage.getItem('pe_session') || 'null');
      if (!sess || (sess.expires && sess.expires < Date.now())) {
        window.location.href = 'index.html?reason=auth_required';
      }
    })();
  