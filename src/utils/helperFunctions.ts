import dotenv from 'dotenv';
import jsonwebtoken from 'jsonwebtoken';

dotenv.config();

export function generateEmailToken(email: string): string {
  const nodeEnv: string = process.env.SENDGRID_API_KEY as string;
  const token = jsonwebtoken.sign({ email }, nodeEnv, {
    expiresIn: '2d',
  });

  return token;
}
