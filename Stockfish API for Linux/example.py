import asyncio
import subprocess
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
lc0_path = os.path.join(current_dir, 'lc0/lc0.exe')

async def communicate_with_stockfish():
    # Create the subprocess for Stockfish
    process = await asyncio.create_subprocess_exec(
        lc0_path,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Start the process listening for output asynchronously
    async def read_output():
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            print(line.decode().strip())

    output_task = asyncio.create_task(read_output())

    # Listen for user input and send commands accordingly
    while True:
        user_input = await asyncio.to_thread(input, 'Enter to go movetime 250: ')
        if user_input.lower() == 'quit':
            break
        elif user_input == '':
            command = 'go movetime 250\n'
            process.stdin.write(command.encode())
            await process.stdin.drain()

    # Close the process
    process.stdin.write('quit\n'.encode())
    await process.stdin.drain()
    await process.wait()

    # Wait for output reading to finish
    await output_task

# Run the asyncio loop
asyncio.run(communicate_with_stockfish())
