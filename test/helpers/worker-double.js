// node --test discovers helper files as well. Run only as a child with a mode.
if (process.argv[2]) {
  const mode = process.argv[2];
  process.stdin.resume();
  process.stdin.once('end', () => {
    switch (mode) {
      case 'hang':
        setInterval(() => {}, 1000);
        process.stdout.write('ready');
        break;
      case 'overflow':
        process.stdout.write(Buffer.alloc(1024));
        setInterval(() => {}, 1000);
        break;
      case 'stderr':
        process.stderr.write(Buffer.alloc(8192));
        setInterval(() => {}, 1000);
        break;
      case 'crash':
        process.stdout.write('partial');
        process.exitCode = 2;
        break;
      case 'unknown':
        process.stderr.write('UNRECOGNIZED_CODE');
        process.exitCode = 1;
        break;
      default:
        process.stdout.write('complete');
    }
  });
}
