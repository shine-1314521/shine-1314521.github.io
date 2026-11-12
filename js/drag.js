/* Drag support for APlayer music player + Live2D kanban girl.
 * Both are position:fixed in the bottom-left corner and overlap.
 * Uses a move-threshold so normal clicks (play/expand) still work.
 * No dependencies. */
(function () {
  'use strict';

  var bound = {};
  var DRAG_THRESHOLD = 6; // px

  function makeDraggable(sel, opts) {
    opts = opts || {};
    var el = document.querySelector(sel);
    if (!el) return false;
    if (bound[sel]) return true;
    bound[sel] = true;

    var dragging = false;
    var startX = 0, startY = 0, origLeft = 0, origTop = 0;

    el.style.cursor = 'grab';
    el.style.pointerEvents = 'auto';
    // re-enable pointer events on the live2d container's children too
    if (el.id === 'live2d-widget') {
      el.style.setProperty('pointer-events', 'auto', 'important');
      var kids = el.querySelectorAll('*');
      for (var k = 0; k < kids.length; k++) {
        kids[k].style.setProperty('pointer-events', 'auto', 'important');
      }
    }

    function onDown(e) {
      var pt = e.touches ? e.touches[0] : e;
      // start tracking, but don't preventDefault yet (allow click through)
      dragging = false;
      startX = pt.clientX;
      startY = pt.clientY;
      var r = el.getBoundingClientRect();
      origLeft = r.left;
      origTop = r.top;
      el._pendingDrag = true;
    }

    function onMove(e) {
      if (!el._pendingDrag) return;
      var pt = e.touches ? e.touches[0] : e;
      var dx = pt.clientX - startX;
      var dy = pt.clientY - startY;
      if (!dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragging = true;
        el.style.position = 'fixed';
        el.style.left = origLeft + 'px';
        el.style.top = origTop + 'px';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.margin = '0';
        el.style.transform = 'none';
        el.style.transition = 'none';
        el.style.cursor = 'grabbing';
      }
      if (!dragging) return;
      var nl = origLeft + dx;
      var nt = origTop + dy;
      var w = el.offsetWidth || 100;
      var h = el.offsetHeight || 100;
      nl = Math.max(0, Math.min(window.innerWidth - w, nl));
      nt = Math.max(0, Math.min(window.innerHeight - h, nt));
      el.style.left = nl + 'px';
      el.style.top = nt + 'px';
      if (e.cancelable) e.preventDefault();
    }

    function onEnd(e) {
      if (!el._pendingDrag) return;
      if (dragging) {
        // swallow the click that follows a drag
        var t = e.target;
        var suppress = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          el.removeEventListener('click', suppress, true);
        };
        el.addEventListener('click', suppress, true);
        setTimeout(function () { el.removeEventListener('click', suppress, true); }, 50);
      }
      dragging = false;
      el._pendingDrag = false;
      el.style.cursor = 'grab';
      el.style.transition = '';
    }

    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var a = makeDraggable('.aplayer-fixed .aplayer-body');
    var l = makeDraggable('#live2d-widget');
    if ((a && l) || tries > 100) {
      clearInterval(timer);
    }
  }, 400);
})();
