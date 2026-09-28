document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    window.scrollTo({ top: target.offsetTop - 66, behavior: 'smooth' });
  });
});
