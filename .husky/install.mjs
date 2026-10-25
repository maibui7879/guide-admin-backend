if (!process.env.CI && process.env.NODE_ENV !== 'production' && process.env.HUSKY !== '0') {
  const { default: husky } = await import('husky');
  const message = husky();
  if (message) {
    console.error(message);
    process.exitCode = 1;
  }
}
