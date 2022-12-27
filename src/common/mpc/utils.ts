export const bn2str = num => '0x' + num.toBuffer('be', 32).toString('hex');
