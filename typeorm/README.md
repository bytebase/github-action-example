# TypeORM Sample

Steps to run this project:

1. Run `npm i` command
1. Setup database settings inside `data-source.ts` file. Make sure to create the database beforehand.
1. Run `npm dev` command. This will start the app in `development` mode and will synchronize the TypeORM
   config with the target database. While in other mode, application won't synchronize the schema and
   needs to migrate the schema separately.
