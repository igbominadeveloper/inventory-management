import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import { Business } from '../business/business.entity';
import { BusinessService } from '../business/business.service';
import {
  ROLE_REPOSITORY_TOKEN,
  USER_REPOSITORY_TOKEN,
} from '../common/config/database.tokens.constants';
import { NotificationService } from '../shared/notification/notification.service';
import { generateEmailToken, isEmail } from '../utils/helperFunctions';

import { Role } from './role.entity';
import { CreateRoleDTO, CreateUserDTO, LoginUserDTO } from './user.dto';
import { User } from './user.entity';

@Injectable()
export class UserService {
  public constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: Repository<User>,
    @Inject(ROLE_REPOSITORY_TOKEN)
    private readonly roleRepository: Repository<Role>,
    private businessService: BusinessService,
    private notificationService: NotificationService,
  ) {}

  public async createRole(name: CreateRoleDTO): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { ...name } });
    if (role) {
      const messages = {
        name: 'Role already exist',
      };
      throw new ConflictException({
        messages,
        status: HttpStatus.CONFLICT,
      });
    }

    return this.roleRepository.create({ ...name }).save();
  }

  public async getRoleByName(name: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { name },
    });
    if (!role) {
      const messages = {
        name: 'Role does not exist',
      };
      throw new NotFoundException({
        messages,
        status: HttpStatus.NOT_FOUND,
      });
    }

    return role;
  }

  public async login(userDTO: LoginUserDTO): Promise<User> {
    const {
      businessName,
      phoneNumberOrEmail,
      password,
    }: LoginUserDTO = userDTO;

    const queryString = isEmail(phoneNumberOrEmail)
      ? 'user.email = :email'
      : 'user.phoneNumber = :phoneNumber';

    const queryObj = isEmail(phoneNumberOrEmail)
      ? { email: phoneNumberOrEmail }
      : { phoneNumber: phoneNumberOrEmail };

    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.businesses', 'businesses')
      .leftJoinAndSelect('user.role', 'role')
      .where(queryString, queryObj)
      .getOne();

    if (!user) {
      throw new BadRequestException({
        messages: {
          phoneNumberOrEmail: 'Invalid crendetials',
        },
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      throw new BadRequestException({
        messages: {
          password: 'Invalid crendetials',
        },
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const isValidBusinessName = user.businesses.some(
      (business: Business): boolean => business.name === businessName,
    );

    if (!isValidBusinessName) {
      throw new BadRequestException({
        messages: {
          businessName: 'Invalid crendetials',
        },
        status: HttpStatus.BAD_REQUEST,
      });
    }

    return user;
  }

  public async register(userDTO: CreateUserDTO): Promise<User> {
    const {
      email,
      businessName,
      phoneNumber,
      password,
      lastName,
      firstName,
    }: CreateUserDTO = userDTO;
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.email = :email OR user.phoneNumber = :phoneNumber', {
        email,
        phoneNumber,
      })
      .getMany();

    let messages: { email?: string; phoneNumber?: string } = {};
    if (user.length) {
      switch (user.length) {
        case 1:
          if (user[0].phoneNumber === phoneNumber) {
            messages.phoneNumber = 'Phone Number already exist';
          }
          if (user[0].email === email) {
            messages.email = 'Email already exist';
          }
          break;
        case 2:
          messages = {
            email: 'Email already exist',
            phoneNumber: 'Phone Number already exist',
          };
          break;
      }
      throw new ConflictException({
        messages,
        status: HttpStatus.CONFLICT,
      });
    }
    const nodeEnv: string = process.env.SALT as string;
    const BASEURL: string = process.env.BASEURL as string;
    const token = generateEmailToken(email);
    const hashedPassword = await bcrypt.hash(password, parseInt(nodeEnv, 10));
    const role = await this.getRoleByName('Owner');
    const business = await this.businessService.register(businessName);
    const newUser = this.userRepository.create({
      email,
      firstName,
      lastName,
      phoneNumber,
      token,
      password: hashedPassword,
    });
    newUser.role = role;
    newUser.businesses = [business];
    newUser.token = token;
    await newUser.save();
    const link = `${BASEURL}/verification?token=${token}`;

    const mail = await this.notificationService.verificationEmail(
      email,
      firstName,
      link,
    );
    Logger.log(mail);

    return newUser;
  }

  public updateToken(id: string, token: string): void {
    this.userRepository.update(id, { token });
  }
}
