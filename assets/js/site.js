// Mobile navigation toggle and research sub-navigation highlighting.
(function () {
  var button = document.querySelector('.nav-button');
  var nav = document.getElementById('site-nav');
  if (button && nav) {
    button.addEventListener('click', function () {
      var open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('is-open', !open);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        button.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
        button.focus();
      }
    });
  }

  var subnav = document.querySelector('.subnav');
  if (subnav && 'IntersectionObserver' in window) {
    var links = Array.prototype.slice.call(subnav.querySelectorAll('a[href^="#"]'));
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var visible = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible[entry.target.id] = entry.isIntersecting; });
      var current = null;
      links.forEach(function (a) {
        var id = a.getAttribute('href').slice(1);
        if (!current && visible[id]) current = id;
      });
      if (current) {
        links.forEach(function (a) { a.classList.toggle('is-active', a === byId[current]); });
        var active = byId[current];
        if (active && active.scrollIntoView && subnav.scrollWidth > subnav.clientWidth) {
          active.parentNode.parentNode.scrollLeft = active.offsetLeft - 24;
        }
      }
    }, { rootMargin: '-130px 0px -55% 0px' });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) observer.observe(el);
    });
  }
})();
