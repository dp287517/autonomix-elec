(function(){


    function deleteCurrentDiscussion(){
      if(!currentIA){ return; }
      const h = getChatHistory();
      const idx = h.findIndex(x => x.id === currentIA);
      if(idx >= 0){
        h.splice(idx, 1);
        setChatHistory(h);
        // Clear current displays
        const chatHtml = document.getElementById('chatHtml');
        const chatHeader = document.getElementById('chatHeader');
        const chatThread = document.getElementById('chatThread');
        if(chatHtml) chatHtml.innerHTML = '';
        if(chatHeader) chatHeader.textContent = '';
        if(chatThread) chatThread.innerHTML = '';
        renderHistory(); renderHistoryChat();
      }
    }
    

})();
