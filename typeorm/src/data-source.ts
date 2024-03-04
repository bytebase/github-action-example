import "reflect-metadata"
import { DataSource } from "typeorm"
import { User } from "./entity/User"

export const AppDataSource = new DataSource({
    type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "postgres",
    database: "test",
    synchronize: process.env.NODE_ENV == 'development',
    logging: false,
    entities: [User],
    migrations: [__dirname + "/migrations/*.ts"],
    subscribers: [],
})
