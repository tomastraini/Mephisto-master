let sf; // Declare the Stockfish module instance globally

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.from === 'content' && msg.subject === 'loadStockfishModule') {
    if (!sf) {
      // Perform the Stockfish module loading logic here
      loadStockfishModule()
        .then(instance => {
          sf = instance.exports;

          // Send initialization commands to Stockfish
          sf.postMessage('ucinewgame');
          sf.postMessage('isready');

          // Function to handle Stockfish responses
          const onStockfishResponse = function (event) {
            // Handle the Stockfish response
            const response = event.data;
            // ...

            // Send the response back to the content script if needed
            sendResponse(response);
          };

          // Attach the event listener to the Stockfish module
          sf.onmessage = onStockfishResponse;

          // Rest of your code to interact with the Stockfish engine
          // ...
        })
        .catch(error => {
          // Handle any errors that occur during the loading of the module
          console.error('Error loading Stockfish module:', error);
          sendResponse({ error: error.message });
        });

      // Return true to indicate that the response will be sent asynchronously
      return true;
    } else {
      // Stockfish module is already loaded, no need to load it again
      sendResponse({ success: true });
    }
  }
});
